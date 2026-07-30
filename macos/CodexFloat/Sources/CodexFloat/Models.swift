import Foundation
import SwiftUI

enum TaskProvider: String {
    case codex
    case claude

    var badge: String {
        switch self {
        case .codex: "CX"
        case .claude: "CL"
        }
    }

    var displayName: String {
        switch self {
        case .codex: "Codex"
        case .claude: "Claude"
        }
    }

    var color: Color {
        switch self {
        case .codex: Color(red: 0.21, green: 0.65, blue: 1)
        case .claude: Color(red: 0.95, green: 0.55, blue: 0.32)
        }
    }
}

enum TaskState: String {
    case active
    case idle
    case needsInput
    case systemError
    case notLoaded

    var label: String {
        switch self {
        case .active: "执行中"
        case .idle: "完成"
        case .needsInput: "待回复"
        case .systemError: "错误"
        case .notLoaded: "等待"
        }
    }

    var symbol: String {
        switch self {
        case .active: "play.fill"
        case .idle: "checkmark"
        case .needsInput: "questionmark"
        case .systemError: "exclamationmark"
        case .notLoaded: "circle"
        }
    }

    var color: Color {
        switch self {
        case .active: Color(red: 0.21, green: 0.65, blue: 1)
        case .idle: Color(red: 0.32, green: 0.84, blue: 0.51)
        case .needsInput: Color(red: 1, green: 0.74, blue: 0.27)
        case .systemError: Color(red: 1, green: 0.37, blue: 0.43)
        case .notLoaded: Color(red: 0.52, green: 0.56, blue: 0.64)
        }
    }
}

struct VibeTask: Identifiable {
    let id: String
    let title: String
    let cwd: String
    let state: TaskState
    let provider: TaskProvider
    let updatedAt: Date

    var projectCode: String {
        let name = URL(fileURLWithPath: cwd).lastPathComponent
        guard !name.isEmpty else { return provider.badge }
        return String(name.prefix(4)).uppercased()
    }

    var sourceProjectLabel: String {
        "\(provider.displayName.uppercased())·\(projectCode)"
    }
}

struct UsageWindow {
    let usedPercent: Double
    let resetsAt: Double?
}

extension Color {
    static func effort(_ effort: String) -> Color {
        switch effort.lowercased() {
        case "minimal": Color(red: 0.52, green: 0.56, blue: 0.64)
        case "low": Color(red: 0.33, green: 0.84, blue: 0.54)
        case "medium": Color(red: 0.21, green: 0.65, blue: 1)
        case "high": Color(red: 1, green: 0.74, blue: 0.27)
        case "xhigh": Color(red: 1, green: 0.48, blue: 0.35)
        case "max": Color(red: 1, green: 0.37, blue: 0.43)
        case "ultra": Color(red: 0.72, green: 0.49, blue: 1)
        default: Color(red: 0.31, green: 0.61, blue: 1)
        }
    }
}
