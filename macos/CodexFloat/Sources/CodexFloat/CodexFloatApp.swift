import SwiftUI

@main
struct VibeFloatApp: App {
    @StateObject private var codex = CodexService()
    @StateObject private var modules = ModuleSettings()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(codex)
                .environmentObject(modules)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }

        MenuBarExtra("Vibe Float", systemImage: "terminal.fill") {
            Button("立即刷新") {
                codex.refresh()
            }
            Menu("显示模块") {
                ForEach(DashboardModule.allCases) { module in
                    Toggle(
                        module.title,
                        isOn: Binding(
                            get: { modules.isEnabled(module) },
                            set: { _ in modules.toggle(module) }
                        )
                    )
                }
            }
            Menu("Claude") {
                Button("启用 Usage 采集") {
                    codex.installClaudeUsageCapture()
                }
                Text("启用后重启 Claude Code 会话")
            }
            Divider()
            Button("退出 Vibe Float") {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q")
        }
    }
}
