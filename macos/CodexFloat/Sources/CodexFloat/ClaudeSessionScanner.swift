import Foundation

enum ClaudeSessionScanner {
    static func scan(limit: Int = 16) -> [VibeTask] {
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/projects", isDirectory: true)
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        var files: [(url: URL, modified: Date)] = []
        for case let url as URL in enumerator where url.pathExtension == "jsonl" {
            guard let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey]),
                  values.isRegularFile == true else { continue }
            files.append((url, values.contentModificationDate ?? .distantPast))
        }

        return files
            .sorted { $0.modified > $1.modified }
            .prefix(max(limit * 2, 24))
            .compactMap(parse)
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(limit)
            .map { $0 }
    }

    private static func parse(_ file: (url: URL, modified: Date)) -> VibeTask? {
        guard let handle = FileHandle(forReadingAtPath: file.url.path) else { return nil }
        defer { try? handle.close() }

        let data: Data
        do {
            let size = try handle.seekToEnd()
            let scan = min(size, 1024 * 1024)
            try handle.seek(toOffset: size - scan)
            data = try handle.readToEnd() ?? Data()
        } catch {
            return nil
        }

        let rawLines = String(decoding: data, as: UTF8.self).split(separator: "\n")
        let lines = data.count >= 1024 * 1024 ? rawLines.dropFirst() : rawLines[...]
        var cwd = ""
        var title = ""
        var fallbackPrompt = ""
        var state: TaskState = .idle
        var lastAssistantText = ""

        for line in lines {
            guard let lineData = line.data(using: .utf8),
                  let record = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] else { continue }
            if let value = record["cwd"] as? String, !value.isEmpty { cwd = value }
            let type = record["type"] as? String ?? ""

            switch type {
            case "ai-title":
                if let value = record["aiTitle"] as? String, !value.isEmpty { title = value }
            case "agent-name":
                if title.isEmpty, let value = record["agentName"] as? String, !value.isEmpty { title = value }
            case "last-prompt":
                if let value = record["lastPrompt"] as? String, !value.isEmpty { fallbackPrompt = value }
            case "user":
                guard record["isMeta"] as? Bool != true else { continue }
                state = .active
            case "assistant":
                if record["isApiErrorMessage"] as? Bool == true || record["error"] != nil {
                    state = .systemError
                    continue
                }
                let message = record["message"] as? [String: Any] ?? [:]
                let content = message["content"] as? [[String: Any]] ?? []
                let asksUser = content.contains {
                    ($0["type"] as? String) == "tool_use" &&
                    ["AskUserQuestion", "ask_user_question"].contains($0["name"] as? String ?? "")
                }
                let usesTool = content.contains { ($0["type"] as? String) == "tool_use" }
                let text = content.compactMap { item -> String? in
                    guard (item["type"] as? String) == "text" else { return nil }
                    return item["text"] as? String
                }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty { lastAssistantText = text }
                if asksUser {
                    state = .needsInput
                } else if usesTool {
                    state = .active
                } else if message["stop_reason"] as? String != nil {
                    state = endsWithQuestion(lastAssistantText) ? .needsInput : .idle
                } else {
                    state = .active
                }
            default:
                break
            }
        }

        if state == .active, Date().timeIntervalSince(file.modified) > 300 {
            state = .idle
        }
        if title.isEmpty { title = fallbackPrompt }
        if title.isEmpty { title = "Claude 任务" }
        let id = file.url.deletingPathExtension().lastPathComponent
        guard !id.isEmpty else { return nil }
        return VibeTask(
            id: id,
            title: title,
            cwd: cwd,
            state: state,
            provider: .claude,
            updatedAt: file.modified
        )
    }

    private static func endsWithQuestion(_ text: String) -> Bool {
        text.hasSuffix("?") || text.hasSuffix("？")
    }
}
