import SwiftUI

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        NavigationSplitView {
            SidebarView(model: model)
                .navigationSplitViewColumnWidth(min: 190, ideal: 220, max: 270)
        } detail: {
            Group {
                switch model.phase {
                case .setup:
                    NewCaptureView(model: model)
                case .capturing:
                    CapturingView(model: model)
                case .result:
                    ResultView(model: model)
                }
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(action: model.showNewCapture) {
                        Label("New Gnaw", systemImage: "plus")
                    }
                    .disabled(model.phase == .capturing)
                }
            }
        }
    }
}

