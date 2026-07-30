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
    }
}
