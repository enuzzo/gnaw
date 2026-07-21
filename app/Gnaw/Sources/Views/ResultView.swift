import SwiftUI

struct ResultView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Group {
            if model.rows.isEmpty {
                overview
            } else {
                VSplitView {
                    overview
                        .frame(
                            minHeight: 188,
                            idealHeight: hasFeedback ? 224 : 198,
                            maxHeight: hasFeedback ? 236 : 206
                        )
                    capturedRequests
                        .frame(minHeight: 260)
                }
            }
        }
        .navigationTitle(model.result == "complete" ? "Capture complete" : "Capture finished")
    }

    private var overview: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                resultHeader
                summaryStrip
                actionBar
                feedback
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
    }

    private var resultHeader: some View {
        HStack(spacing: 12) {
            GnawMark(active: false, compact: true)
            VStack(alignment: .leading, spacing: 2) {
                Text(URL(string: model.configuration.url)?.host ?? model.configuration.url)
                    .font(.system(size: 23, weight: .bold, design: .rounded))
                    .lineLimit(1)
                Text(model.configuration.url)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            ResultBadge(result: model.result ?? "complete")
        }
    }

    private var summaryStrip: some View {
        HStack(spacing: 0) {
            CompactMetric(title: "Pages", value: "\(model.summary?.pages ?? model.pages)", icon: "doc.on.doc")
            metricDivider
            CompactMetric(title: "Assets", value: "\(model.summary?.assets ?? model.assets)", icon: "shippingbox")
            metricDivider
            CompactMetric(
                title: "Size",
                value: ByteCountFormatter.string(fromByteCount: model.summary?.bytes ?? model.bytes, countStyle: .file),
                icon: "externaldrive"
            )
            metricDivider
            CompactMetric(title: "Duration", value: duration(model.summary?.durationMs ?? model.elapsedMs), icon: "clock")
        }
        .padding(.vertical, 9)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 11))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(.separator.opacity(0.35)))
    }

    private var metricDivider: some View {
        Divider().frame(height: 34)
    }

    private var actionBar: some View {
        HStack(spacing: 8) {
            if model.configuration.output.includesNavigable {
                Button(action: model.openOfflineWebsite) {
                    Label("Open offline", systemImage: "safari")
                }
            }

            Button(action: model.openCaptureFolder) {
                Label("Show in Finder", systemImage: "folder")
            }

            if model.configuration.output.includesStudy {
                Button(action: model.copyStudyContext) {
                    Label("Copy context", systemImage: "doc.on.clipboard")
                }
            }

            Spacer(minLength: 12)

            Label(model.haulPath ?? "Capture folder unavailable", systemImage: "internaldrive")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .help(model.haulPath ?? "Capture folder unavailable")
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .padding(9)
        .background(Color.secondary.opacity(0.045), in: RoundedRectangle(cornerRadius: 11))
    }

    @ViewBuilder
    private var feedback: some View {
        if let message = model.actionMessage {
            Label(message, systemImage: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.green)
        } else if let error = model.errorMessage {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.orange)
        }
    }

    private var capturedRequests: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Label("Captured requests", systemImage: "water.waves")
                    .font(.headline)
                Text("\(model.visibleRows.count) of \(model.rows.count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                TextField("Filter requests", text: $model.filter)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 240)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            WaterfallTable(
                rows: model.visibleRows,
                emptyTitle: "No matching requests",
                emptyDescription: "Try a different filter."
            )
        }
    }

    private func duration(_ milliseconds: Int) -> String {
        let seconds = milliseconds / 1_000
        return seconds < 60 ? "\(seconds)s" : "\(seconds / 60)m \(seconds % 60)s"
    }

    private var hasFeedback: Bool {
        model.actionMessage != nil || model.errorMessage != nil
    }
}

private struct CompactMetric: View {
    let title: String
    let value: String
    let icon: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .foregroundStyle(.secondary)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.system(.body, design: .monospaced).weight(.semibold))
                    .monospacedDigit()
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
        }
        .padding(.horizontal, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ResultBadge: View {
    let result: String

    var body: some View {
        Text(result.uppercased())
            .font(.caption2.bold())
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background((result == "complete" ? Color.green : Color.orange).opacity(0.18), in: Capsule())
            .foregroundStyle(result == "complete" ? .green : .orange)
    }
}
