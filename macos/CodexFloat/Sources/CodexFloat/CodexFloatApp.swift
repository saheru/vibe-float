import SwiftUI

@main
struct CodexFloatApp: App {
    @StateObject private var codex = CodexService()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(codex)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }

        MenuBarExtra("Codex Float", systemImage: "terminal.fill") {
            Button("立即刷新") {
                codex.refresh()
            }
            Divider()
            Button("退出 Codex Float") {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q")
        }
    }
}
