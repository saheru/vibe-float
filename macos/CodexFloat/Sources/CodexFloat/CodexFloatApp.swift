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
            Menu("最近任务数量") {
                ForEach(1...8, id: \.self) { count in
                    Button {
                        modules.setTaskCount(count)
                    } label: {
                        if modules.taskCount == count {
                            Label("\(count) 个", systemImage: "checkmark")
                        } else {
                            Text("\(count) 个")
                        }
                    }
                }
            }
            Menu("显示模块") {
                ForEach(modules.configurableModules) { module in
                    Toggle(
                        module.title,
                        isOn: Binding(
                            get: { modules.isEnabled(module) },
                            set: { _ in modules.toggle(module) }
                        )
                    )
                }
            }
            Menu("CLI 终端") {
                ForEach(TerminalPreference.allCases) { terminal in
                    Button {
                        modules.setPreferredTerminal(terminal)
                    } label: {
                        if modules.preferredTerminal == terminal {
                            Label(terminal.title, systemImage: "checkmark")
                        } else {
                            Text(terminal.title)
                        }
                    }
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
