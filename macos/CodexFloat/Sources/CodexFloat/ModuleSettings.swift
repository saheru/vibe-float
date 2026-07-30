import Foundation

enum DashboardModule: String, CaseIterable, Identifiable {
    case task1
    case task2
    case task3
    case task4
    case task5
    case task6
    case task7
    case task8
    case codexEffort
    case codexFiveHourUsage
    case codexUsage
    case claudeModel
    case claudeEffort
    case claudeUsage

    var id: String { rawValue }

    var title: String {
        switch self {
        case .task1: "最近任务 1"
        case .task2: "最近任务 2"
        case .task3: "最近任务 3"
        case .task4: "最近任务 4"
        case .task5: "最近任务 5"
        case .task6: "最近任务 6"
        case .task7: "最近任务 7"
        case .task8: "最近任务 8"
        case .codexEffort: "Codex · Sol Effort"
        case .codexFiveHourUsage: "Codex · 5h Usage"
        case .codexUsage: "Codex · 周 Usage"
        case .claudeModel: "Claude · Model"
        case .claudeEffort: "Claude · Effort"
        case .claudeUsage: "Claude · 周 Usage"
        }
    }

    var taskIndex: Int? {
        switch self {
        case .task1: 0
        case .task2: 1
        case .task3: 2
        case .task4: 3
        case .task5: 4
        case .task6: 5
        case .task7: 6
        case .task8: 7
        default: nil
        }
    }
}

@MainActor
final class ModuleSettings: ObservableObject {
    @Published private(set) var enabled: Set<DashboardModule>
    @Published private(set) var taskCount: Int
    private let defaults = UserDefaults.standard
    private let key = "vibeFloat.enabledModules"
    private let taskCountKey = "vibeFloat.taskCount"

    init() {
        if let stored = defaults.array(forKey: key) as? [String] {
            enabled = Set(stored.compactMap(DashboardModule.init(rawValue:)))
        } else {
            enabled = Set(DashboardModule.allCases)
        }
        let storedCount = defaults.integer(forKey: taskCountKey)
        taskCount = storedCount == 0 ? 3 : min(8, max(1, storedCount))
        if !defaults.bool(forKey: "vibeFloat.didAddCodexFiveHourUsage") {
            enabled.insert(.codexFiveHourUsage)
            defaults.set(true, forKey: "vibeFloat.didAddCodexFiveHourUsage")
            persistEnabled()
        }
    }

    func isEnabled(_ module: DashboardModule) -> Bool {
        enabled.contains(module)
    }

    func toggle(_ module: DashboardModule) {
        guard module.taskIndex == nil else { return }
        if enabled.contains(module) {
            guard enabled.count > 1 else { return }
            enabled.remove(module)
        } else {
            enabled.insert(module)
        }
        defaults.set(enabled.map(\.rawValue).sorted(), forKey: key)
    }

    func setTaskCount(_ count: Int) {
        taskCount = min(8, max(1, count))
        defaults.set(taskCount, forKey: taskCountKey)
    }

    var ordered: [DashboardModule] {
        DashboardModule.allCases.filter { module in
            if let index = module.taskIndex { return index < taskCount }
            return enabled.contains(module)
        }
    }

    var configurableModules: [DashboardModule] {
        DashboardModule.allCases.filter { $0.taskIndex == nil }
    }

    private func persistEnabled() {
        defaults.set(enabled.map(\.rawValue).sorted(), forKey: key)
    }
}
