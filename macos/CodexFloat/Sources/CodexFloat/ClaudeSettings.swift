import Foundation

struct ClaudeConfiguration {
    let model: String
    let effort: String
}

enum ClaudeSettings {
    static let models = ["sonnet", "opus", "fable", "haiku"]
    static let efforts = ["low", "medium", "high", "xhigh", "max"]

    static var settingsURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/settings.json")
    }

    static var usageCacheURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Vibe Float/claude-status.json")
    }

    static func read() -> ClaudeConfiguration {
        let root = readJSON(settingsURL)
        return ClaudeConfiguration(
            model: root["model"] as? String ?? "sonnet",
            effort: root["effortLevel"] as? String ?? "high"
        )
    }

    static func write(key: String, value: String) throws {
        var root = readJSON(settingsURL)
        root[key] = value
        let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
        try FileManager.default.createDirectory(
            at: settingsURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: settingsURL, options: .atomic)
    }

    static func readUsage() -> (fiveHour: UsageWindow?, sevenDay: UsageWindow?) {
        let root = readJSON(usageCacheURL)
        let limits = root["rate_limits"] as? [String: Any] ?? [:]
        return (
            usage(limits["five_hour"]),
            usage(limits["seven_day"])
        )
    }

    static func installUsageCapture(helperPath: String) throws {
        var root = readJSON(settingsURL)
        var status = root["statusLine"] as? [String: Any] ?? [:]
        let current = status["command"] as? String ?? ""
        if current.contains("VibeFloatStatus") { return }
        let next = Data(current.utf8).base64EncodedString()
        let command = "\(shellQuote(helperPath)) --next-base64 \(shellQuote(next))"
        status["type"] = "command"
        status["command"] = command
        if status["padding"] == nil { status["padding"] = 0 }
        root["statusLine"] = status
        let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: settingsURL, options: .atomic)
    }

    private static func usage(_ raw: Any?) -> UsageWindow? {
        guard let value = raw as? [String: Any],
              let percent = number(value["used_percentage"]) else { return nil }
        return UsageWindow(usedPercent: percent, resetsAt: number(value["resets_at"]))
    }

    private static func readJSON(_ url: URL) -> [String: Any] {
        guard let data = try? Data(contentsOf: url),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return root
    }

    private static func number(_ value: Any?) -> Double? {
        if let value = value as? NSNumber { return value.doubleValue }
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        return nil
    }

    private static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
