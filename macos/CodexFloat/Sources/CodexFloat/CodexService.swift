import AppKit
import Foundation

@MainActor
final class CodexService: ObservableObject {
    @Published var tasks: [VibeTask] = []
    @Published var codexModel = "DEFAULT"
    @Published var codexPermission = "AUTO"
    @Published var solEffort = "medium"
    @Published var fiveHourUsage: UsageWindow?
    @Published var weeklyUsage: UsageWindow?
    @Published var claudeModel = "sonnet"
    @Published var claudeEffort = "high"
    @Published var claudeFiveHourUsage: UsageWindow?
    @Published var claudeWeeklyUsage: UsageWindow?
    @Published var connected = false
    @Published var lastError: String?

    private var codexTasks: [VibeTask] = []
    private var claudeTasks: [VibeTask] = []
    private var process: Process?
    private var sharedHost: Process?
    private var webSocket: URLSessionWebSocketTask?
    private var stdin: FileHandle?
    private var readBuffer = Data()
    private var nextID = 1
    private var pending: [Int: (Result<[String: Any], Error>) -> Void] = [:]
    private var models: [[String: Any]] = []
    private var supportedSolEfforts: [String] = ["low", "medium", "high", "xhigh"]
    private var taskTimer: Timer?
    private var usageTimer: Timer?
    private var staticTimer: Timer?
    private var claudeTimer: Timer?
    private var reconnectTimer: Timer?
    private var eventRefreshTimer: Timer?
    private var isRefreshingTasks = false
    private var isRefreshingUsage = false
    private var isRefreshingStatic = false
    private var stateCache: [String: (signature: String, state: TaskState)] = [:]
    private var isRefreshingClaude = false
    private var shouldRun = false
    private var lastServerError = ""
    private var isStartingCodex = false
    private var selectedCodexThreadID: String?
    private var currentModelID: String?
    private var currentPermissionIndex = 1
    private let permissions = [
        (name: "只读", short: "READ", sandbox: "read-only", approval: "untrusted"),
        (name: "工作区", short: "AUTO", sandbox: "workspace-write", approval: "on-request"),
        (name: "完全访问", short: "FULL", sandbox: "danger-full-access", approval: "never")
    ]
    private let sharedEndpoint = ProcessInfo.processInfo.environment["VIBE_CODEX_APP_SERVER"]
        ?? "ws://127.0.0.1:45876"

    func start() {
        shouldRun = true
        startClaudeMonitoring()
        guard process == nil, webSocket == nil, !isStartingCodex else { return }
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        isStartingCodex = true
        Task { await startCodexConnection() }
    }

    private func startCodexConnection() async {
        defer { isStartingCodex = false }
        do {
            try launchSharedHost()
            var lastError: Error?
            for _ in 0..<30 {
                do {
                    try await connectSharedServer()
                    return
                } catch {
                    lastError = error
                    closeWebSocket()
                    try? await Task.sleep(for: .milliseconds(100))
                }
            }
            throw lastError ?? ServiceError.message("共享 Codex App Server 启动超时")
        } catch {
            // Older Codex builds without WebSocket transport keep the original
            // stdio behavior; immediate per-thread switching is then disabled.
            startStdioServer()
        }
    }

    private func launchSharedHost() throws {
        if let sharedHost, sharedHost.isRunning { return }
        sharedHost = nil
        let executable = try findCodex()
        let host = Process()
        host.executableURL = URL(fileURLWithPath: executable)
        host.arguments = ["app-server", "--listen", sharedEndpoint]
        host.environment = codexEnvironment(executable: executable)
        host.standardInput = FileHandle.nullDevice
        host.standardOutput = FileHandle.nullDevice
        host.standardError = FileHandle.nullDevice
        try host.run()
        sharedHost = host
    }

    private func connectSharedServer() async throws {
        guard let url = URL(string: sharedEndpoint) else {
            throw ServiceError.message("无效的共享 App Server 地址")
        }
        let socket = URLSession.shared.webSocketTask(with: url)
        webSocket = socket
        socket.resume()
        receiveWebSocket(socket)
        try await requestVoidAsync("initialize", params: [
            "clientInfo": [
                "name": "vibe_float",
                "title": "Vibe Float",
                "version": "0.5.8"
            ],
            "capabilities": ["experimentalApi": true, "requestAttestation": false]
        ])
        notify("initialized", params: [:])
        finishConnectedStart()
    }

    private func startStdioServer() {
        guard process == nil else { return }
        do {
            let task = Process()
            let input = Pipe()
            let output = Pipe()
            let errorOutput = Pipe()
            let executable = try findCodex()
            task.executableURL = URL(fileURLWithPath: executable)
            task.arguments = ["app-server"]
            task.environment = codexEnvironment(executable: executable)
            task.standardInput = input
            task.standardOutput = output
            task.standardError = errorOutput
            task.terminationHandler = { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.connected = false
                    self.process = nil
                    self.stdin = nil
                    self.stopCodexTimers()
                    if !self.lastServerError.isEmpty {
                        self.lastError = self.lastServerError
                    }
                    self.scheduleReconnect()
                }
            }
            output.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                Task { @MainActor in self?.consume(data) }
            }
            errorOutput.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                let message = String(decoding: data, as: UTF8.self)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                guard !message.isEmpty else { return }
                Task { @MainActor in self?.lastServerError = message }
            }
            try task.run()
            lastServerError = ""
            process = task
            stdin = input.fileHandleForWriting
            request("initialize", params: [
                "clientInfo": [
                    "name": "vibe_float",
                    "title": "Vibe Float",
                    "version": "0.5.8"
                ],
                "capabilities": ["experimentalApi": true, "requestAttestation": false]
            ]) { [weak self] result in
                guard let self else { return }
                if case .failure(let error) = result {
                    self.fail(error)
                    self.process?.terminate()
                    return
                }
                self.notify("initialized", params: [:])
                self.finishConnectedStart()
            }
        } catch {
            connected = false
            fail(error)
            scheduleReconnect()
        }
    }

    private func finishConnectedStart() {
        connected = true
        refresh()
        taskTimer?.invalidate()
        usageTimer?.invalidate()
        staticTimer?.invalidate()
        taskTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshTasks() }
        }
        usageTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshUsage() }
        }
        staticTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshStatic() }
        }
    }

    func stop() {
        shouldRun = false
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        stopCodexTimers()
        claudeTimer?.invalidate()
        eventRefreshTimer?.invalidate()
        claudeTimer = nil
        eventRefreshTimer = nil
        closeWebSocket()
        process?.terminate()
        process = nil
        connected = false
    }

    private func closeWebSocket() {
        let socket = webSocket
        webSocket = nil
        socket?.cancel(with: .goingAway, reason: nil)
    }

    func openTask(_ task: VibeTask, terminal: TerminalPreference = .automatic) {
        switch task.provider {
        case .codex:
            if task.codexSurface == .cli {
                selectedCodexThreadID = task.id
                let cwd = task.cwd.isEmpty ? FileManager.default.homeDirectoryForCurrentUser.path : task.cwd
                let executable = (try? findCodex()) ?? "codex"
                let command = "cd \(shellQuote(cwd)) && \(shellQuote(executable)) --remote \(shellQuote(sharedEndpoint)) resume \(shellQuote(task.id))"
                TerminalRouter.openSession(id: task.id, provider: .codex, cwd: cwd, command: command, preference: terminal)
                return
            }
            guard let encoded = task.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
                  let url = URL(string: "codex://threads/\(encoded)") else { return }
            NSWorkspace.shared.open(url)
        case .claude:
            let cwd = task.cwd.isEmpty ? FileManager.default.homeDirectoryForCurrentUser.path : task.cwd
            let command = "cd \(shellQuote(cwd)) && claude --resume \(shellQuote(task.id))"
            TerminalRouter.openSession(id: task.id, provider: .claude, cwd: cwd, command: command, preference: terminal)
        }
    }

    func cycleSolEffort(_ direction: Int = 1) {
        guard connected, !supportedSolEfforts.isEmpty else { return }
        let current = supportedSolEfforts.firstIndex(of: solEffort) ?? 0
        let next = (current + (direction >= 0 ? 1 : -1) + supportedSolEfforts.count) % supportedSolEfforts.count
        let effort = supportedSolEfforts[next]
        guard let sol = solModelID else {
            lastError = "当前账号没有可用的 Sol 模型"
            return
        }
        request("config/batchWrite", params: [
            "edits": [
                ["keyPath": "model", "value": sol, "mergeStrategy": "upsert"],
                ["keyPath": "model_reasoning_effort", "value": effort, "mergeStrategy": "upsert"]
            ],
            "reloadUserConfig": true
        ]) { [weak self] result in
            switch result {
            case .success:
                self?.solEffort = effort
                self?.updateSelectedThread([
                    "model": sol,
                    "effort": effort
                ])
            case .failure(let error):
                self?.fail(error)
            }
        }
    }

    func cycleCodexModel(_ direction: Int = 1) {
        guard connected, !models.isEmpty else { return }
        let current = models.firstIndex { ($0["model"] as? String) == currentModelID } ?? 0
        let next = models[(current + (direction >= 0 ? 1 : -1) + models.count) % models.count]
        guard let modelID = next["model"] as? String else { return }
        let efforts = (next["supportedReasoningEfforts"] as? [[String: Any]] ?? [])
            .compactMap { $0["reasoningEffort"] as? String }
        let effort = efforts.contains(solEffort)
            ? solEffort
            : (next["defaultReasoningEffort"] as? String ?? solEffort)
        request("config/batchWrite", params: [
            "edits": [
                ["keyPath": "model", "value": modelID, "mergeStrategy": "upsert"],
                ["keyPath": "model_reasoning_effort", "value": effort, "mergeStrategy": "upsert"]
            ],
            "reloadUserConfig": true
        ]) { [weak self] result in
            switch result {
            case .success:
                guard let self else { return }
                self.currentModelID = modelID
                self.codexModel = Self.shortModel(next["displayName"] as? String ?? modelID)
                self.solEffort = effort
                self.updateSelectedThread(["model": modelID, "effort": effort])
            case .failure(let error): self?.fail(error)
            }
        }
    }

    func cycleCodexPermission(_ direction: Int = 1) {
        guard connected else { return }
        let next = (currentPermissionIndex + (direction >= 0 ? 1 : -1) + permissions.count) % permissions.count
        let permission = permissions[next]
        request("config/batchWrite", params: [
            "edits": [
                ["keyPath": "sandbox_mode", "value": permission.sandbox, "mergeStrategy": "upsert"],
                ["keyPath": "approval_policy", "value": permission.approval, "mergeStrategy": "upsert"]
            ],
            "reloadUserConfig": true
        ]) { [weak self] result in
            switch result {
            case .success:
                guard let self else { return }
                self.currentPermissionIndex = next
                self.codexPermission = permission.short
                let policyType = permission.sandbox == "read-only"
                    ? "readOnly"
                    : permission.sandbox == "danger-full-access" ? "dangerFullAccess" : "workspaceWrite"
                self.updateSelectedThread([
                    "approvalPolicy": permission.approval,
                    "sandboxPolicy": ["type": policyType]
                ])
            case .failure(let error): self?.fail(error)
            }
        }
    }

    private func updateSelectedThread(_ settings: [String: Any]) {
        guard webSocket != nil, let threadID = selectedCodexThreadID else { return }
        request("thread/settings/update", params: ["threadId": threadID].merging(settings) { _, new in new }) { [weak self] result in
            if case .failure(let error) = result,
               !error.localizedDescription.localizedCaseInsensitiveContains("thread not found") {
                self?.fail(error)
            }
        }
    }

    func refresh() {
        refreshTasks()
        refreshUsage()
        refreshStatic()
        refreshClaude()
    }

    func cycleClaudeModel(_ direction: Int = 1) {
        let choices = ([claudeModel] + ClaudeSettings.models).reduce(into: [String]()) {
            if !$0.contains($1) { $0.append($1) }
        }
        let current = choices.firstIndex(of: claudeModel) ?? 0
        let next = choices[(current + (direction >= 0 ? 1 : -1) + choices.count) % choices.count]
        do {
            try ClaudeSettings.write(key: "model", value: next)
            claudeModel = next
        } catch {
            lastError = error.localizedDescription
        }
    }

    func cycleClaudeEffort(_ direction: Int = 1) {
        let choices = ClaudeSettings.efforts
        let current = choices.firstIndex(of: claudeEffort) ?? 0
        let next = choices[(current + (direction >= 0 ? 1 : -1) + choices.count) % choices.count]
        do {
            try ClaudeSettings.write(key: "effortLevel", value: next)
            claudeEffort = next
        } catch {
            lastError = error.localizedDescription
        }
    }

    func installClaudeUsageCapture() {
        let helper = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Helpers/VibeFloatStatus").path
        guard FileManager.default.isExecutableFile(atPath: helper) else {
            lastError = "找不到 Claude Usage 采集组件"
            return
        }
        do {
            try ClaudeSettings.installUsageCapture(helperPath: helper)
            refreshClaude()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func refreshTasks() {
        guard connected, !isRefreshingTasks else { return }
        isRefreshingTasks = true
        request("thread/list", params: [
            "limit": 16,
            "sortKey": "updated_at",
            "sortDirection": "desc",
            "archived": false,
            "useStateDbOnly": true
        ]) { [weak self] result in
            guard let self else { return }
            self.isRefreshingTasks = false
            switch result {
            case .success(let value):
                self.applyThreads(value)
                self.connected = true
                self.lastError = nil
            case .failure(let error):
                self.fail(error)
            }
        }
    }

    func refreshUsage() {
        guard connected, !isRefreshingUsage else { return }
        isRefreshingUsage = true
        request("account/rateLimits/read", params: [:]) { [weak self] result in
            guard let self else { return }
            self.isRefreshingUsage = false
            if case .success(let value) = result {
                self.fiveHourUsage = Self.extractFiveHour(value)
                self.weeklyUsage = Self.extractWeek(value)
            }
        }
    }

    func refreshStatic() {
        guard connected, !isRefreshingStatic else { return }
        isRefreshingStatic = true
        let group = DispatchGroup()
        var modelResult: [String: Any]?
        var configResult: [String: Any]?
        group.enter()
        request("model/list", params: ["limit": 100, "includeHidden": false]) { result in
            if case .success(let value) = result { modelResult = value }
            group.leave()
        }
        group.enter()
        request("config/read", params: ["includeLayers": false]) { result in
            if case .success(let value) = result { configResult = value }
            group.leave()
        }
        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            self.isRefreshingStatic = false
            self.apply(models: modelResult, config: configResult)
        }
    }

    private var solModelID: String? {
        models.first {
            let id = $0["model"] as? String ?? ""
            let name = $0["displayName"] as? String ?? ""
            return id == "gpt-5.6-sol" || "\(id) \(name)".lowercased().contains("sol")
        }?["model"] as? String
    }

    private func apply(models result: [String: Any]?, config resultConfig: [String: Any]?) {
        if let data = result?["data"] as? [[String: Any]] {
            models = data.filter { !($0["hidden"] as? Bool ?? false) }
            if let sol = models.first(where: {
                let id = $0["model"] as? String ?? ""
                let name = $0["displayName"] as? String ?? ""
                return id == "gpt-5.6-sol" || "\(id) \(name)".lowercased().contains("sol")
            }), let efforts = sol["supportedReasoningEfforts"] as? [[String: Any]] {
                let values = efforts.compactMap { $0["reasoningEffort"] as? String }
                if !values.isEmpty { supportedSolEfforts = values }
            }
        }
        let config = resultConfig?["config"] as? [String: Any] ?? [:]
        currentModelID = config["model"] as? String
            ?? models.first(where: { ($0["isDefault"] as? Bool) == true })?["model"] as? String
            ?? models.first?["model"] as? String
        if let current = models.first(where: { ($0["model"] as? String) == currentModelID }) {
            codexModel = Self.shortModel(current["displayName"] as? String ?? currentModelID ?? "DEFAULT")
        }
        let sandbox = config["sandbox_mode"] as? String
        if let index = permissions.firstIndex(where: { $0.sandbox == sandbox }) {
            currentPermissionIndex = index
        }
        codexPermission = permissions[currentPermissionIndex].short
        let configured = config["model_reasoning_effort"] as? String
        if let configured, supportedSolEfforts.contains(configured) {
            solEffort = configured
        } else if let sol = models.first(where: { ($0["model"] as? String) == solModelID }),
                  let fallback = sol["defaultReasoningEffort"] as? String {
            solEffort = fallback
        }
    }

    private static func shortModel(_ value: String) -> String {
        let cleaned = value
            .replacingOccurrences(of: "GPT-", with: "", options: .caseInsensitive)
            .replacingOccurrences(of: " ", with: "")
        return String(cleaned.prefix(9)).uppercased()
    }

    private func applyThreads(_ result: [String: Any]?) {
        let raw = result?["data"] as? [[String: Any]] ?? []
        codexTasks = raw
            .filter { $0["parentThreadId"] == nil || $0["parentThreadId"] is NSNull }
            .prefix(16)
            .compactMap { item in
                guard let id = item["id"] as? String else { return nil }
                let title = item["name"] as? String ?? item["preview"] as? String ?? "未命名任务"
                let cwd = item["cwd"] as? String ?? ""
                let surface = CodexSurface(source: item["source"] as? String ?? "")
                return VibeTask(
                    id: id,
                    title: title,
                    cwd: cwd,
                    state: inferState(item),
                    provider: .codex,
                    updatedAt: Date(timeIntervalSince1970: Self.number(item["updatedAt"]) ?? 0),
                    codexSurface: surface
                )
            }
        mergeTasks()
    }

    private func startClaudeMonitoring() {
        guard claudeTimer == nil else { return }
        refreshClaude()
        claudeTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshClaude() }
        }
    }

    private func refreshClaude() {
        guard !isRefreshingClaude else { return }
        isRefreshingClaude = true
        DispatchQueue.global(qos: .utility).async {
            let sessions = ClaudeSessionScanner.scan(limit: 8)
            let configuration = ClaudeSettings.read()
            let usage = ClaudeSettings.readUsage()
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.claudeTasks = sessions
                self.claudeModel = configuration.model
                self.claudeEffort = configuration.effort
                self.claudeFiveHourUsage = usage.fiveHour
                self.claudeWeeklyUsage = usage.sevenDay
                self.isRefreshingClaude = false
                self.mergeTasks()
            }
        }
    }

    private func mergeTasks() {
        tasks = (codexTasks + claudeTasks)
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(8)
            .map { $0 }
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private func inferState(_ thread: [String: Any]) -> TaskState {
        let status = thread["status"] as? [String: Any]
        let type = status?["type"] as? String
        let flags = status?["activeFlags"] as? [String] ?? []
        if flags.contains(where: { ["waitingOnApproval", "waitingOnUserInput", "needsInput"].contains($0) }) {
            return .needsInput
        }
        if let type, type != "notLoaded" {
            return TaskState(rawValue: type) ?? .notLoaded
        }
        guard let path = thread["path"] as? String else { return .idle }
        let attributes = try? FileManager.default.attributesOfItem(atPath: path)
        let size = (attributes?[.size] as? NSNumber)?.int64Value ?? -1
        let modified = (attributes?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        let signature = "\(size):\(modified)"
        if let cached = stateCache[path], cached.signature == signature {
            return cached.state
        }
        let state = Self.inferStateFromRollout(path)
        stateCache[path] = (signature, state)
        return state
    }

    private static func inferStateFromRollout(_ path: String) -> TaskState {
        guard let handle = FileHandle(forReadingAtPath: path) else { return .notLoaded }
        defer { try? handle.close() }
        do {
            let size = try handle.seekToEnd()
            let scan = min(size, 8 * 1024 * 1024)
            try handle.seek(toOffset: size - scan)
            let data = try handle.readToEnd() ?? Data()
            let lines = String(decoding: data, as: UTF8.self).split(separator: "\n").reversed()
            var turnComplete = false
            var assistantQuestion = false
            var sawActivity = false
            var completedCalls = Set<String>()
            for line in lines {
                guard let data = line.data(using: .utf8),
                      let record = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                let recordType = record["type"] as? String ?? ""
                let payload = record["payload"] as? [String: Any] ?? [:]
                if ["response_item", "turn_context"].contains(recordType) { sawActivity = true }
                if recordType == "response_item" {
                    let payloadType = payload["type"] as? String ?? ""
                    let callID = payload["call_id"] as? String
                    if ["function_call_output", "custom_tool_call_output"].contains(payloadType), let callID {
                        completedCalls.insert(callID)
                    }
                    if ["function_call", "custom_tool_call"].contains(payloadType),
                       payload["name"] as? String == "request_user_input",
                       callID.map({ !completedCalls.contains($0) }) ?? true {
                        return .needsInput
                    }
                    if turnComplete, payloadType == "message", payload["role"] as? String == "assistant" {
                        assistantQuestion = messageEndsWithQuestion(payload["content"])
                    }
                }
                guard recordType == "event_msg" else { continue }
                let event = payload["type"] as? String ?? ""
                if !["task_complete", "turn_aborted", "error"].contains(event) { sawActivity = true }
                if event == "task_started" {
                    if assistantQuestion { return .needsInput }
                    return turnComplete ? .idle : .active
                }
                if event == "task_complete" { turnComplete = true }
                if ["turn_aborted", "error"].contains(event) { return .systemError }
            }
            if assistantQuestion { return .needsInput }
            if turnComplete { return .idle }
            return sawActivity ? .active : .idle
        } catch {
            return .notLoaded
        }
    }

    private static func messageEndsWithQuestion(_ raw: Any?) -> Bool {
        let content = raw as? [[String: Any]] ?? []
        let text = content.compactMap { item -> String? in
            let type = item["type"] as? String
            guard type == "output_text" || type == "text" else { return nil }
            return item["text"] as? String
        }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return text.hasSuffix("?") || text.hasSuffix("？")
    }

    private static func extractWeek(_ result: [String: Any]?) -> UsageWindow? {
        extractWindow(result, targetMinutes: 10_080) { $0 > 600 }
    }

    private static func extractFiveHour(_ result: [String: Any]?) -> UsageWindow? {
        extractWindow(result, targetMinutes: 300) { $0 > 0 && $0 <= 600 }
    }

    private static func extractWindow(
        _ result: [String: Any]?,
        targetMinutes: Double,
        accepts: (Double) -> Bool
    ) -> UsageWindow? {
        guard let result else { return nil }
        var snapshots: [[String: Any]] = []
        if let canonical = result["rateLimits"] as? [String: Any] { snapshots.append(canonical) }
        if let byID = result["rateLimitsByLimitId"] as? [String: Any] {
            if let codex = byID["codex"] as? [String: Any] { snapshots.append(codex) }
            for (key, value) in byID where key != "codex" {
                if let snapshot = value as? [String: Any] { snapshots.append(snapshot) }
            }
        }
        var windows: [[String: Any]] = []
        for snapshot in snapshots {
            for key in ["primary", "secondary"] {
                if let window = snapshot[key] as? [String: Any],
                   let duration = number(window["windowDurationMins"]), accepts(duration),
                   !windows.contains(where: { number($0["windowDurationMins"]) == duration }) {
                    windows.append(window)
                }
            }
        }
        guard let best = windows.min(by: {
            abs((number($0["windowDurationMins"]) ?? 0) - targetMinutes)
                < abs((number($1["windowDurationMins"]) ?? 0) - targetMinutes)
        }) else { return nil }
        return UsageWindow(
            usedPercent: min(100, max(0, number(best["usedPercent"]) ?? 0)),
            resetsAt: number(best["resetsAt"])
        )
    }

    private static func number(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        return nil
    }

    private func request(
        _ method: String,
        params: [String: Any],
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        let id = nextID
        nextID += 1
        pending[id] = completion
        send(["method": method, "id": id, "params": params])
    }

    private func requestVoidAsync(_ method: String, params: [String: Any]) async throws {
        try await withCheckedThrowingContinuation { continuation in
            request(method, params: params) { result in
                switch result {
                case .success: continuation.resume(returning: ())
                case .failure(let error): continuation.resume(throwing: error)
                }
            }
        }
    }

    private func notify(_ method: String, params: [String: Any]) {
        send(["method": method, "params": params])
    }

    private func send(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        if let socket = webSocket {
            let text = String(decoding: data, as: UTF8.self)
            Task {
                do {
                    // Codex app-server expects JSON-RPC in WebSocket text
                    // frames. Binary frames remain open but are not decoded.
                    try await socket.send(.string(text))
                } catch {
                    await MainActor.run { self.handleWebSocketFailure(error, socket: socket) }
                }
            }
            return
        }
        guard let stdin else { return }
        do {
            try stdin.write(contentsOf: data + Data([0x0A]))
        } catch {
            fail(error)
        }
    }

    private func receiveWebSocket(_ socket: URLSessionWebSocketTask) {
        socket.receive { [weak self, weak socket] result in
            guard let self, let socket else { return }
            Task { @MainActor in
                guard self.webSocket === socket else { return }
                switch result {
                case .success(.data(let data)):
                    self.consumeMessage(data)
                    self.receiveWebSocket(socket)
                case .success(.string(let text)):
                    self.consumeMessage(Data(text.utf8))
                    self.receiveWebSocket(socket)
                case .failure(let error):
                    self.handleWebSocketFailure(error, socket: socket)
                @unknown default:
                    self.handleWebSocketFailure(ServiceError.message("未知 WebSocket 消息"), socket: socket)
                }
            }
        }
    }

    private func handleWebSocketFailure(_ error: Error, socket: URLSessionWebSocketTask) {
        guard webSocket === socket else { return }
        closeWebSocket()
        connected = false
        for callback in pending.values { callback(.failure(error)) }
        pending.removeAll()
        fail(error)
        stopCodexTimers()
        if !isStartingCodex { scheduleReconnect() }
    }

    private func consume(_ data: Data) {
        readBuffer.append(data)
        while let newline = readBuffer.firstIndex(of: 0x0A) {
            let line = readBuffer[..<newline]
            readBuffer.removeSubrange(...newline)
            consumeMessage(Data(line))
        }
    }

    private func consumeMessage(_ data: Data) {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if let id = (object["id"] as? NSNumber)?.intValue, let callback = pending.removeValue(forKey: id) {
            if let errorObject = object["error"] as? [String: Any] {
                callback(.failure(ServiceError.message(errorObject["message"] as? String ?? "Codex 请求失败")))
            } else {
                callback(.success(object["result"] as? [String: Any] ?? [:]))
            }
        }
        if let method = object["method"] as? String, method.hasPrefix("thread/"), eventRefreshTimer == nil {
            eventRefreshTimer = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: false) { [weak self] _ in
                Task { @MainActor in
                    self?.eventRefreshTimer = nil
                    self?.refreshTasks()
                }
            }
        }
    }

    private func fail(_ error: Error) {
        lastError = error.localizedDescription
        isRefreshingTasks = false
        isRefreshingUsage = false
        isRefreshingStatic = false
    }

    private func stopCodexTimers() {
        taskTimer?.invalidate()
        usageTimer?.invalidate()
        staticTimer?.invalidate()
        taskTimer = nil
        usageTimer = nil
        staticTimer = nil
    }

    private func scheduleReconnect() {
        guard shouldRun, reconnectTimer == nil else { return }
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.reconnectTimer = nil
                self?.start()
            }
        }
    }

    private func codexEnvironment(executable: String) -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let executableDirectory = URL(fileURLWithPath: executable).deletingLastPathComponent().path
        let additions = [
            executableDirectory,
            "\(home)/.local/share/fnm/aliases/default/bin",
            "\(home)/.local/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin"
        ]
        let existing = environment["PATH"] ?? ""
        environment["PATH"] = (additions + [existing])
            .filter { !$0.isEmpty }
            .joined(separator: ":")
        return environment
    }

    private func findCodex() throws -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            ProcessInfo.processInfo.environment["CODEX_PATH"],
            "\(home)/.local/share/fnm/aliases/default/bin/codex",
            "\(home)/.local/bin/codex",
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex"
        ].compactMap { $0 }
        if let path = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
            return path
        }
        throw ServiceError.message("找不到 Codex CLI")
    }
}

enum ServiceError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let text) = self { return text }
        return "未知错误"
    }
}
