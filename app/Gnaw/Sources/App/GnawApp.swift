import AppKit
import SwiftUI

@main
struct GnawApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup("Gnaw", id: "main") {
            ContentView(model: model)
                .frame(minWidth: 940, minHeight: 640)
                .tint(.orange)
        }
        .defaultSize(width: 1180, height: 760)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Gnaw") { model.showNewCapture() }
                    .keyboardShortcut("n", modifiers: .command)
            }
            CommandMenu("Haul") {
                Button("Reveal in Finder") { model.openCaptureFolder() }
                    .keyboardShortcut("r", modifiers: .command)
                    .disabled(!model.canOpenHaul)

                Button("Copy Study Context") { model.copyStudyContext() }
                    .keyboardShortcut("c", modifiers: [.command, .shift])
                    .disabled(!model.canCopyStudyContext)

                Divider()

                Button("Refresh Library") { model.reloadLibrary() }
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}
