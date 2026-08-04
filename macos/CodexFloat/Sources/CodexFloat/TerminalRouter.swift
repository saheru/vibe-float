import AppKit
import Foundation

enum TerminalPreference: String, CaseIterable, Identifiable {
    case automatic
    case otty
    case terminal
    case iTerm2
    case ghostty
    case kitty
    case wezTerm

    var id: String { rawValue }

    var title: String {
        switch self {
        case .automatic: "自动识别"
        case .otty: "Otty"
        case .terminal: "Terminal"
        case .iTerm2: "iTerm2"
        case .ghostty: "Ghostty"
        case .kitty: "Kitty"
        case .wezTerm: "WezTerm"
        }
    }
}

enum TerminalRouter {
    static func openSession(
        id: String,
        provider: TaskProvider,
        cwd: String,
        command: String,
        preference: TerminalPreference
    ) {
        // Otty keeps an exact agent-session -> pane mapping. Always prefer an
        // exact live match, even when another fallback terminal is selected.
        if focusOttySession(id: id, provider: provider) { return }

        let target = preference == .automatic ? detectedTerminal() : preference
        if launch(command: command, cwd: cwd, in: target) { return }
        _ = launch(command: command, cwd: cwd, in: .terminal)
    }

    private static func focusOttySession(id: String, provider: TaskProvider) -> Bool {
        guard id.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else { return false }
        let home = FileManager.default.homeDirectoryForCurrentUser
        let database = home.appendingPathComponent("Library/Application Support/io.appmakes.otty/state.db").path
        guard FileManager.default.fileExists(atPath: database) else { return false }
        guard let cli = ottyCLI() else { return false }

        // Otty exposes its pane id to every child process. A fresh Codex TUI
        // starts at the UUIDv7 session timestamp, which lets us recover the
        // exact pane even while Otty's transient resume_key is empty.
        if provider == .codex,
           let pane = findOttyPaneByCodexLaunch(id: id, database: database),
           focusOttyPane(pane, cli: cli) { return true }

        let kind = provider == .claude ? "claude" : "codex"
        let query = "SELECT id FROM pane WHERE program_type='\(kind)' AND resume_key='\(id)' AND closed_at IS NULL LIMIT 1;"
        guard let pane = capture("/usr/bin/sqlite3", [database, query])?.trimmingCharacters(in: .whitespacesAndNewlines),
              !pane.isEmpty else {
            if let resumed = findOttyPaneByResumeCommand(id: id, provider: provider, database: database) {
                return focusOttyPane(resumed, cli: cli)
            }
            return false
        }
        return focusOttyPane(pane, cli: cli)
    }

    private static func focusOttyPane(_ pane: String, cli: String) -> Bool {
        let selector = pane.hasPrefix("p_") ? pane : "p_\(pane)"
        guard run(cli, ["pane", "focus", selector]) == 0 else { return false }
        _ = runAppleScript("tell application \"Otty\" to activate")
        return true
    }

    private static func findOttyPaneByCodexLaunch(id: String, database: String) -> String? {
        guard let sessionStart = uuidV7Time(id) else { return nil }
        return runningOttyProcesses(database: database, commandFilter: isInteractiveCodexCommand)
            .filter { abs($0.startedAt.timeIntervalSince(sessionStart)) <= 120 }
            .min { abs($0.startedAt.timeIntervalSince(sessionStart)) < abs($1.startedAt.timeIntervalSince(sessionStart)) }?
            .pane
    }

    private static func findOttyPaneByResumeCommand(
        id: String,
        provider: TaskProvider,
        database: String
    ) -> String? {
        let marker = provider == .claude ? "claude --resume \(id)" : "codex resume \(id)"
        return runningOttyProcesses(database: database, commandFilter: { $0.contains(marker) }).first?.pane
    }

    private static func runningOttyProcesses(
        database: String,
        commandFilter: (String) -> Bool
    ) -> [(command: String, startedAt: Date, pane: String)] {
        guard let listing = capture("/bin/ps", ["ax", "-o", "pid=,etime=,command="]) else { return [] }
        let now = Date()
        var processes: [(command: String, startedAt: Date, pane: String)] = []
        for line in listing.split(separator: "\n") {
            let fields = line.split(maxSplits: 2, omittingEmptySubsequences: true, whereSeparator: { $0.isWhitespace })
            guard fields.count == 3,
                  let elapsed = elapsedSeconds(String(fields[1])) else { continue }
            let pid = String(fields[0])
            let command = String(fields[2])
            guard commandFilter(command) else { continue }
            guard let environment = capture("/bin/ps", ["eww", "-p", pid, "-o", "command="]),
                  let pane = environment.firstRegexCapture(#"(?:^|\s)OTTY_PANE_ID=([A-Za-z0-9_-]+)"#),
                  isActiveOttyPane(pane, database: database) else { continue }
            processes.append((command, now.addingTimeInterval(-elapsed), pane))
        }
        return processes
    }

    private static func isActiveOttyPane(_ pane: String, database: String) -> Bool {
        guard pane.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else { return false }
        let raw = pane.hasPrefix("p_") ? String(pane.dropFirst(2)) : pane
        let query = "SELECT COUNT(*) FROM pane WHERE id='\(raw)' AND closed_at IS NULL;"
        return capture("/usr/bin/sqlite3", [database, query])?.trimmingCharacters(in: .whitespacesAndNewlines) == "1"
    }

    private static func isInteractiveCodexCommand(_ command: String) -> Bool {
        guard command.range(
            of: #"(?:^|\s)(?:node\s+\S*/codex|\S*/codex)(?:\s|$)"#,
            options: .regularExpression
        ) != nil else { return false }
        return !command.contains(" app-server")
            && !command.contains(" codex exec")
            && !command.contains("codex-code-mode-host")
    }

    private static func uuidV7Time(_ id: String) -> Date? {
        let compact = id.replacingOccurrences(of: "-", with: "")
        guard compact.range(of: #"^[0-9A-Fa-f]{32}$"#, options: .regularExpression) != nil,
              compact[compact.index(compact.startIndex, offsetBy: 12)].lowercased() == "7",
              let milliseconds = UInt64(compact.prefix(12), radix: 16) else { return nil }
        return Date(timeIntervalSince1970: Double(milliseconds) / 1000)
    }

    private static func elapsedSeconds(_ value: String) -> TimeInterval? {
        let dayParts = value.split(separator: "-", maxSplits: 1).map(String.init)
        let days: Double
        let clock: String
        if dayParts.count == 2 {
            guard let parsedDays = Double(dayParts[0]) else { return nil }
            days = parsedDays
            clock = dayParts[1]
        } else {
            days = 0
            clock = value
        }
        let clockParts = clock.split(separator: ":").compactMap { Double($0) }
        guard clockParts.count == 2 || clockParts.count == 3 else { return nil }
        let hours = clockParts.count == 3 ? clockParts[0] : 0
        let minutes = clockParts.count == 3 ? clockParts[1] : clockParts[0]
        let seconds = clockParts.count == 3 ? clockParts[2] : clockParts[1]
        return ((days * 24 + hours) * 60 + minutes) * 60 + seconds
    }

    private static func detectedTerminal() -> TerminalPreference {
        let names = Set(NSWorkspace.shared.runningApplications.compactMap { $0.localizedName?.lowercased() })
        for candidate in [TerminalPreference.otty, .iTerm2, .ghostty, .kitty, .wezTerm, .terminal]
            where names.contains(candidate.processName.lowercased()) {
            return candidate
        }
        return .terminal
    }

    private static func launch(command: String, cwd: String, in terminal: TerminalPreference) -> Bool {
        let escaped = appleScriptText(command)
        switch terminal {
        case .automatic:
            return launch(command: command, cwd: cwd, in: detectedTerminal())
        case .otty, .terminal:
            let app = terminal == .otty ? "Otty" : "Terminal"
            let script = "tell application \"\(app)\" to activate\ntell application \"\(app)\" to do script \"\(escaped)\""
            return runAppleScript(script)
        case .iTerm2:
            let script = "tell application \"iTerm2\" to activate\ntell application \"iTerm2\" to create window with default profile command \"\(escaped)\""
            return runAppleScript(script)
        case .ghostty:
            let script = """
            tell application "Ghostty"
                activate
                set cfg to new surface configuration
                set initial working directory of cfg to "\(appleScriptText(cwd))"
                set command of cfg to "\(escaped)"
                new window with configuration cfg
            end tell
            """
            return runAppleScript(script)
        case .kitty:
            if let cli = executable(["/Applications/kitty.app/Contents/MacOS/kitty", "/usr/local/bin/kitty", "/opt/homebrew/bin/kitty"]),
               run(cli, ["@", "launch", "--type=tab", "--cwd", cwd, "/bin/zsh", "-lc", command]) == 0 {
                NSWorkspace.shared.launchApplication("kitty")
                return true
            }
            return false
        case .wezTerm:
            if let cli = executable(["/Applications/WezTerm.app/Contents/MacOS/wezterm", "/usr/local/bin/wezterm", "/opt/homebrew/bin/wezterm"]),
               run(cli, ["cli", "spawn", "--cwd", cwd, "--", "/bin/zsh", "-lc", command]) == 0 {
                NSWorkspace.shared.launchApplication("WezTerm")
                return true
            }
            return false
        }
    }

    private static func ottyCLI() -> String? {
        executable([
            "/Applications/Otty.app/Contents/MacOS/otty-cli",
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/Otty.app/Contents/MacOS/otty-cli").path,
            "/usr/local/bin/otty",
            "/opt/homebrew/bin/otty"
        ])
    }

    private static func executable(_ candidates: [String]) -> String? {
        candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    private static func run(_ executable: String, _ arguments: [String]) -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run(); process.waitUntilExit(); return process.terminationStatus } catch { return -1 }
    }

    private static func capture(_ executable: String, _ arguments: [String]) -> String? {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return nil }
            return String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        } catch { return nil }
    }

    private static func appleScriptText(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: " ")
    }

    private static func runAppleScript(_ source: String) -> Bool {
        guard let script = NSAppleScript(source: source) else { return false }
        var error: NSDictionary?
        _ = script.executeAndReturnError(&error)
        return error == nil
    }
}

private extension TerminalPreference {
    var processName: String {
        switch self {
        case .automatic: ""
        case .otty: "Otty"
        case .terminal: "Terminal"
        case .iTerm2: "iTerm2"
        case .ghostty: "Ghostty"
        case .kitty: "kitty"
        case .wezTerm: "WezTerm"
        }
    }
}

private extension String {
    func firstRegexCapture(_ pattern: String) -> String? {
        guard let expression = try? NSRegularExpression(pattern: pattern),
              let match = expression.firstMatch(in: self, range: NSRange(startIndex..., in: self)),
              match.numberOfRanges > 1,
              let range = Range(match.range(at: 1), in: self) else { return nil }
        return String(self[range])
    }
}
