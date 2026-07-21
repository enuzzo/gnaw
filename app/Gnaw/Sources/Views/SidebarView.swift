import SwiftUI

struct SidebarView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        List(selection: selection) {
            Section("Gnaw") {
                Label("New capture", systemImage: "plus.circle.fill")
                    .tag(SidebarSelection.newCapture)
                    .disabled(model.phase == .capturing)
            }

            if model.phase == .capturing {
                Section("Current") {
                    HStack(spacing: 10) {
                        Image(systemName: "waveform.path.ecg")
                            .foregroundStyle(.orange)
                            .frame(width: 16)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(currentHost)
                                .lineLimit(1)
                            Text(model.engineState.capitalized)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .tag(SidebarSelection.currentCapture)
                }
            }

            Section("Hauls") {
                if model.hauls.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Nothing gnawed yet", systemImage: "archivebox")
                        Text("Finished captures will stay here.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                } else {
                    ForEach(model.hauls) { haul in
                        HaulSidebarRow(haul: haul)
                            .tag(SidebarSelection.haul(haul.id))
                            .contextMenu {
                                Button("Re-gnaw with These Settings") {
                                    model.prepareRegnaw(haul)
                                }
                                Button("Reveal in Finder") {
                                    model.revealHaul(haul)
                                }
                            }
                    }
                }
            }

            Section {
                Button("Refresh Library", systemImage: "arrow.clockwise") {
                    model.reloadLibrary()
                }
                .buttonStyle(.plain)

                if model.unreadableManifestCount > 0 {
                    Label(
                        "\(model.unreadableManifestCount) unreadable \(model.unreadableManifestCount == 1 ? "manifest" : "manifests")",
                        systemImage: "exclamationmark.triangle"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Gnaw")
    }

    private var selection: Binding<SidebarSelection?> {
        Binding(
            get: { model.sidebarSelection },
            set: { model.selectSidebar($0) }
        )
    }

    private var currentHost: String {
        URL(string: model.configuration.url)?.host ?? model.configuration.url
    }
}

private struct HaulSidebarRow: View {
    let haul: HaulRecord

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: resultIcon)
                .foregroundStyle(resultColor)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 2) {
                Text(haul.host)
                    .lineLimit(1)
                Text("\(haul.startedAt.formatted(date: .abbreviated, time: .shortened)) · \(formattedSize)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .help("\(haul.result.capitalized) · \(haul.summary.pages) pages · \(haul.summary.assets) assets")
    }

    private var formattedSize: String {
        ByteCountFormatter.string(fromByteCount: haul.summary.bytes, countStyle: .file)
    }

    private var resultIcon: String {
        switch haul.result {
        case "complete": "checkmark.circle.fill"
        case "canceled": "stop.circle.fill"
        default: "exclamationmark.circle.fill"
        }
    }

    private var resultColor: Color {
        switch haul.result {
        case "complete": .green
        case "canceled": .secondary
        default: .orange
        }
    }
}
