import SwiftUI

struct GnawMark: View {
    let active: Bool
    var compact = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: compact ? 12 : 20)
                .fill(.orange.gradient)
            Image(systemName: active ? "waveform.path.ecg" : "bolt.horizontal.circle.fill")
                .font(.system(size: compact ? 24 : 38, weight: .bold))
                .foregroundStyle(.black.opacity(0.72))
        }
        .frame(width: compact ? 48 : 76, height: compact ? 48 : 76)
        .shadow(color: .orange.opacity(0.22), radius: 18, y: 6)
        .accessibilityLabel(active ? "Gnaw is capturing" : "Gnaw")
    }
}

struct KindChip: View {
    let kind: String

    var body: some View {
        Text(kind)
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundStyle(color)
            .frame(width: 42)
            .padding(.vertical, 3)
            .background(color.opacity(0.13), in: Capsule())
    }

    private var color: Color {
        switch kind {
        case "HTML": .orange
        case "JS": .yellow
        case "CSS": .blue
        case "IMG": .green
        case "JSON": .purple
        case "FONT": .pink
        case "MEDIA": .teal
        case "WASM": .brown
        default: .gray
        }
    }
}

struct WaterfallTable: View {
    let rows: [WaterfallRow]
    let emptyTitle: String
    let emptyDescription: String

    var body: some View {
        Table(rows) {
            TableColumn("Kind") { row in
                KindChip(kind: row.kind)
            }
            .width(min: 48, ideal: 54, max: 60)

            TableColumn("Request") { row in
                WaterfallRequestCell(row: row)
            }

            TableColumn("Size") { row in
                Text(row.bytes.map {
                    ByteCountFormatter.string(fromByteCount: $0, countStyle: .file)
                } ?? "—")
                .monospacedDigit()
            }
            .width(min: 66, ideal: 78, max: 90)

            TableColumn("Status") { row in
                Text(row.status.map(String.init) ?? (row.isInFlight ? "•••" : "—"))
                    .monospacedDigit()
                    .foregroundStyle(statusColor(for: row))
            }
            .width(min: 48, ideal: 54, max: 62)

            TableColumn("Time") { row in
                Text(formattedDuration(row.durationMs))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            .width(min: 56, ideal: 66, max: 76)
        }
        .overlay {
            if rows.isEmpty {
                ContentUnavailableView(
                    emptyTitle,
                    systemImage: "network",
                    description: Text(emptyDescription)
                )
            }
        }
    }

    private func formattedDuration(_ durationMs: Int?) -> String {
        guard let durationMs else { return "—" }
        return durationMs < 1_000 ? "\(durationMs) ms" : String(format: "%.1f s", Double(durationMs) / 1_000)
    }

    private func statusColor(for row: WaterfallRow) -> Color {
        guard let status = row.status else { return .secondary }
        if status >= 400 { return .orange }
        if status >= 300 { return .secondary }
        return .primary
    }
}
