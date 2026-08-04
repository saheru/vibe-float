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
        let kind = provider == .claude ? "claude" : "codex"
        let query = "SELECT id FROM pane WHERE program_type='\(kind)' AND resume_key='\(id)' AND closed_at IS NULL LIMIT 1;"
        guard let pane = capture("/usr/bin/sqlite3", [database, query])?.trimmingCharacters(in: .whitespacesAndNewlines),
              !pane.isEmpty,
              let cli = ottyCLI() else { return false }
        let selector = pane.hasPrefix("p_") ? pane : "p_\(pane)"
        guard run(cli, ["pane", "focus", selector]) == 0 else { return false }
        _ = runAppleScript("tell application \"Otty\" to activate")
        return true
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
