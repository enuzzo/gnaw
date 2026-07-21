import SwiftUI

struct CapturingView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            stats
            Divider()
            filterBar
            waterfall
            Divider()
            controls
        }
        .navigationTitle("Capturing")
    }

    private var header: some View {
        HStack(spacing: 14) {
            GnawMark(active: model.engineState == "running", compact: true)
            VStack(alignment: .leading, spacing: 4) {
                Text(URL(string: model.configuration.url)?.host ?? model.configuration.url)
                    .font(.title2.bold())
                Text(model.configuration.url)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if let stack = model.stackName {
                Label(stack, systemImage: "shippingbox.fill")
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.orange.opacity(0.14), in: Capsule())
            }
            Text(duration(model.elapsedMs))
                .font(.system(.body, design: .monospaced))
                .monospacedDigit()
        }
        .padding(14)
    }

    private var stats: some View {
        HStack(spacing: 0) {
            StatCell(title: "Pages", value: "\(model.pages)")
            StatCell(title: "Assets", value: "\(model.assets)")
            StatCell(title: "Downloaded", value: ByteCountFormatter.string(fromByteCount: model.bytes, countStyle: .file))
            StatCell(title: "Queue", value: "\(model.queued)")
            StatCell(title: "State", value: model.engineState.capitalized)
        }
        .padding(.vertical, 8)
    }

    private var filterBar: some View {
        HStack {
            Label("Waterfall", systemImage: "water.waves")
                .font(.headline)
            Text("\(model.visibleRows.count) requests")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            TextField("Filter requests", text: $model.filter)
                .textFieldStyle(.roundedBorder)
                .frame(width: 240)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var waterfall: some View {
        WaterfallTable(
            rows: model.visibleRows,
            emptyTitle: model.rows.isEmpty ? "Waiting for the first bite" : "No matching requests",
            emptyDescription: model.rows.isEmpty
                ? "Requests will appear here as Chromium loads the page."
                : "Try a different filter."
        )
    }

    private var controls: some View {
        HStack {
            if let error = model.errorMessage {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .lineLimit(2)
            } else {
                Text(model.logLines.last ?? "The engine is starting…")
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Button(model.engineState == "paused" ? "Resume" : "Pause", action: model.togglePause)
                .keyboardShortcut(.space, modifiers: [])
                .disabled(model.engineState != "running" && model.engineState != "paused")
            Button("Cancel", role: .destructive, action: model.cancel)
                .keyboardShortcut(".", modifiers: .command)
                .disabled(model.engineState == "canceled" || model.engineState == "failed")
        }
        .padding(10)
    }

    private func duration(_ milliseconds: Int) -> String {
        let seconds = milliseconds / 1000
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

private struct StatCell: View {
    let title: String
    let value: String

    var body: some View {
        VStack(spacing: 4) {
            Text(value).font(.system(.title3, design: .monospaced).weight(.semibold)).monospacedDigit()
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
