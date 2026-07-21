import SwiftUI
import UniformTypeIdentifiers

struct NewCaptureView: View {
    @ObservedObject var model: AppModel
    @State private var advanced = false
    @State private var showOutputFolderPicker = false
    @FocusState private var urlFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    addressCard
                    captureScope
                    outputChoice
                    advancedOptions
                }
                .frame(maxWidth: 820)
                .padding(.horizontal, 28)
                .padding(.vertical, 22)
                .frame(maxWidth: .infinity)
            }
            Divider()
            startArea
                .frame(maxWidth: 820)
                .padding(.horizontal, 28)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity)
                .background(.bar)
        }
        .onAppear { urlFocused = true }
        .fileImporter(
            isPresented: $showOutputFolderPicker,
            allowedContentTypes: [.folder],
            allowsMultipleSelection: false
        ) { result in
            if case .success(let urls) = result, let directory = urls.first {
                model.setOutputDirectory(directory)
            }
        }
        .alert("Download browser engine?", isPresented: Binding(
            get: { model.browserDownload == .confirming },
            set: { if !$0, model.browserDownload == .confirming { model.cancelBrowserDownload() } }
        )) {
            Button("Download") { model.confirmBrowserDownload() }
            Button("Cancel", role: .cancel) { model.cancelBrowserDownload() }
        } message: {
            Text("Gnaw needs a browser engine to capture sites and none was found. Download Chromium now? This is a one-time ~150MB download.")
        }
        .overlay {
            switch model.browserDownload {
            case .checking:
                VStack(spacing: 12) {
                    ProgressView().controlSize(.large)
                    Text("Checking for a browser…").font(.callout).foregroundStyle(.secondary)
                }
                .padding(24)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            case .downloading(let detail):
                VStack(spacing: 12) {
                    ProgressView().controlSize(.large)
                    Text(detail).font(.callout).foregroundStyle(.secondary)
                    Button("Cancel") { model.cancelBrowserDownload() }
                }
                .padding(24)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            default:
                EmptyView()
            }
        }
        .alert("Download failed", isPresented: Binding(
            get: { if case .failed = model.browserDownload { return true } else { return false } },
            set: { if !$0 { model.cancelBrowserDownload() } }
        )) {
            Button("OK", role: .cancel) { model.cancelBrowserDownload() }
        } message: {
            if case .failed(let message) = model.browserDownload { Text(message) }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            GnawMark(active: false, compact: true)
            VStack(alignment: .leading, spacing: 4) {
                Text("New capture")
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                Text("Tell Gnaw where to start. The recommended setup is already selected.")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var addressCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(number: 1, title: "Website address")
            TextField("https://example.com", text: $model.configuration.url)
                .textFieldStyle(.plain)
                .font(.system(size: 16, design: .monospaced))
                .padding(11)
                .background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(.separator.opacity(0.7)))
                .focused($urlFocused)
                .onSubmit(model.startCapture)
            Text("You can paste an address without https:// — Gnaw will add it for you.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var captureScope: some View {
        VStack(alignment: .leading, spacing: 9) {
            SectionLabel(number: 2, title: "How much should Gnaw explore?")
            HStack(alignment: .top, spacing: 9) {
                ForEach(CapturePreset.allCases) { preset in
                    ChoiceCard(
                        title: preset.title,
                        detail: preset.detail,
                        icon: preset.icon,
                        isRecommended: preset.isRecommended,
                        isSelected: model.configuration.preset == preset
                    ) {
                        model.configuration.preset = preset
                    }
                }
            }
        }
    }

    private var outputChoice: some View {
        VStack(alignment: .leading, spacing: 9) {
            SectionLabel(number: 3, title: "What should Gnaw create?")
            VStack(spacing: 7) {
                ForEach(CaptureOutput.allCases) { output in
                    OutputChoiceRow(
                        output: output,
                        isSelected: model.configuration.output == output
                    ) {
                        model.configuration.output = output
                    }
                }
            }
        }
    }

    private var advancedOptions: some View {
        DisclosureGroup(isExpanded: $advanced) {
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 12) {
                GridRow {
                    Text("Maximum pages").foregroundStyle(.secondary)
                    Stepper(value: $model.configuration.maxPages, in: 1...10_000) {
                        Text(model.configuration.maxPages, format: .number).monospacedDigit()
                    }
                }
                GridRow {
                    Text("Save captures in").foregroundStyle(.secondary)
                    HStack {
                        TextField("Output folder", text: $model.configuration.outputDirectory)
                            .font(.system(.body, design: .monospaced))
                            .onSubmit(model.commitOutputDirectory)
                        Button("Choose…") {
                            showOutputFolderPicker = true
                        }
                    }
                }
            }
            .padding(.top, 10)
        } label: {
            Label("Advanced options", systemImage: "slider.horizontal.3")
                .font(.headline)
        }
        .padding(12)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
    }

    private var startArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = model.errorMessage {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
            }
            if let message = model.actionMessage {
                Label(message, systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
                    .foregroundStyle(.secondary)
            }
            HStack {
                Label("Ready: \(model.configuration.preset.title) · \(model.configuration.output.title)", systemImage: "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Spacer()
                Button(action: model.startCapture) {
                    Label("Start capture", systemImage: "play.fill")
                        .font(.headline)
                        .frame(minWidth: 150)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!model.canStart || model.browserDownload != .idle)
                .keyboardShortcut(.return, modifiers: [])
            }
        }
    }
}

private struct SectionLabel: View {
    let number: Int
    let title: String

    var body: some View {
        HStack(spacing: 9) {
            Text("\(number)")
                .font(.caption.bold())
                .foregroundStyle(.black.opacity(0.75))
                .frame(width: 22, height: 22)
                .background(.orange, in: Circle())
            Text(title).font(.headline)
        }
    }
}

private struct ChoiceCard: View {
    let title: String
    let detail: String
    let icon: String
    let isRecommended: Bool
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: icon)
                        .font(.title3)
                        .foregroundStyle(isSelected ? .orange : .secondary)
                    Spacer()
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(isSelected ? Color.orange : Color.secondary.opacity(0.45))
                }
                HStack(spacing: 7) {
                    Text(title).font(.headline)
                    if isRecommended {
                        Text("RECOMMENDED")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundStyle(.orange)
                    }
                }
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(11)
            .frame(maxWidth: .infinity, minHeight: 106, alignment: .topLeading)
            .background(isSelected ? Color.orange.opacity(0.10) : Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(isSelected ? Color.orange.opacity(0.75) : Color.secondary.opacity(0.16), lineWidth: isSelected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
    }
}

private struct OutputChoiceRow: View {
    let output: CaptureOutput
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: output.icon)
                    .font(.title3)
                    .foregroundStyle(isSelected ? .orange : .secondary)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(output.title).font(.headline)
                        if output.isRecommended {
                            Text("RECOMMENDED")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.orange)
                        }
                    }
                    Text(output.detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSelected ? Color.orange : Color.secondary.opacity(0.45))
            }
            .padding(10)
            .background(isSelected ? Color.orange.opacity(0.10) : Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 11))
            .overlay(RoundedRectangle(cornerRadius: 11).stroke(isSelected ? Color.orange.opacity(0.7) : Color.secondary.opacity(0.13)))
        }
        .buttonStyle(.plain)
    }
}
