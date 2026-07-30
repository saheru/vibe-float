import Foundation

enum DashboardModule: String, CaseIterable, Identifiable {
    case task1
    case task2
    case task3
    case codexEffort
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
        case .codexEffort: "Codex · Sol Effort"
        case .codexUsage: "Codex · 周 Usage"
        case .claudeModel: "Claude · Model"
        case .claudeEffort: "Claude · Effort"
        case .claudeUsage: "Claude · 周 Usage"
        }
    }
}

@MainActor
final class ModuleSettings: ObservableObject {
    @Published private(set) var enabled: Set<DashboardModule>
    private let defaults = UserDefaults.standard
    private let key = "vibeFloat.enabledModules"

    init() {
        if let stored = defaults.array(forKey: key) as? [String] {
            enabled = Set(stored.compactMap(DashboardModule.init(rawValue:)))
        } else {
            enabled = Set(DashboardModule.allCases)
        }
    }

    func isEnabled(_ module: DashboardModule) -> Bool {
        enabled.contains(module)
    }

    func toggle(_ module: DashboardModule) {
        if enabled.contains(module) {
            guard enabled.count > 1 else { return }
            enabled.remove(module)
        } else {
            enabled.insert(module)
        }
        defaults.set(enabled.map(\.rawValue).sorted(), forKey: key)
    }

    var ordered: [DashboardModule] {
        DashboardModule.allCases.filter(enabled.contains)
    }
}
