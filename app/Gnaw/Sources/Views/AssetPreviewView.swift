import AppKit
import ImageIO
import SwiftUI
import WebKit

struct WaterfallRequestCell: View {
    let row: WaterfallRow

    @State private var showsPreview = false
    @State private var cellIsHovered = false
    @State private var previewIsHovered = false
    @State private var hoverTask: Task<Void, Never>?

    var body: some View {
        HStack(spacing: 5) {
            VStack(alignment: .leading, spacing: 1) {
                Text(row.displayPath)
                    .font(.system(.caption, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let host = URL(string: row.url)?.host {
                    Text(host)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if cellIsHovered, row.localFileURL != nil {
                Image(systemName: "eye")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .contentShape(Rectangle())
        .help(row.localFilePath == nil ? row.url : "Hover or click to preview • Right-click for file actions")
        .accessibilityHint(row.localFilePath == nil ? "Captured request" : "Hover or click to preview the local file")
        .accessibilityAction(named: "Show Preview") {
            showPreview()
        }
        .onTapGesture(perform: showPreview)
        .onHover(perform: updateCellHover)
        .popover(isPresented: $showsPreview, arrowEdge: .top) {
            AssetPreviewPopover(row: row)
                .frame(width: 390, height: 290)
                .onHover(perform: updatePreviewHover)
        }
        .contextMenu {
            if let fileURL = row.localFileURL {
                Button("Open File") {
                    NSWorkspace.shared.open(fileURL)
                }
                Button("Reveal in Finder") {
                    NSWorkspace.shared.activateFileViewerSelecting([fileURL])
                }
                Divider()
            }
            Button("Copy Request URL") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(row.url, forType: .string)
            }
        }
        .onDisappear {
            hoverTask?.cancel()
        }
    }

    private func updateCellHover(_ hovering: Bool) {
        cellIsHovered = hovering
        hoverTask?.cancel()

        guard row.localFileURL != nil else {
            showsPreview = false
            return
        }

        hoverTask = Task { @MainActor in
            try? await Task.sleep(for: hovering ? .milliseconds(380) : .milliseconds(220))
            guard !Task.isCancelled else { return }
            if hovering {
                showsPreview = true
            } else if !previewIsHovered {
                showsPreview = false
            }
        }
    }

    private func showPreview() {
        guard row.localFileURL != nil else { return }
        hoverTask?.cancel()
        showsPreview = true
    }

    private func updatePreviewHover(_ hovering: Bool) {
        previewIsHovered = hovering
        if hovering {
            hoverTask?.cancel()
        } else if !cellIsHovered {
            hoverTask?.cancel()
            hoverTask = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(160))
                guard !Task.isCancelled, !cellIsHovered else { return }
                showsPreview = false
            }
        }
    }
}

private struct AssetPreviewPopover: View {
    let row: WaterfallRow

    @State private var preview: AssetPreview = .loading

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                KindChip(kind: row.kind)
                Text(row.localFileURL?.lastPathComponent ?? row.displayPath)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                if let bytes = row.bytes {
                    Text(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)

            Divider()

            previewBody
        }
        .task(id: row.localFilePath) {
            preview = .loading
            preview = await AssetPreviewLoader.load(row: row)
        }
    }

    @ViewBuilder
    private var previewBody: some View {
        switch preview {
        case .loading:
            ProgressView()
                .controlSize(.small)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .image(let image):
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .padding(12)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(checkerboard)

        case .svg(let data):
            SVGPreviewWebView(data: data)
                .background(checkerboard)

        case .source(let source, let truncated, let notice):
            VStack(spacing: 0) {
                if let notice {
                    Label(notice, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                    Divider()
                }
                SourcePreviewTextView(source: source, kind: sourceSyntaxKind)
                if truncated {
                    Divider()
                    Text("Showing the first 48 KB")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                }
            }
            .background(Color(nsColor: .textBackgroundColor).opacity(0.55))

        case .unavailable(let reason):
            ContentUnavailableView(
                "No inline preview",
                systemImage: iconForUnavailablePreview,
                description: Text(reason)
            )
        }
    }

    private var checkerboard: some View {
        ZStack {
            Color(nsColor: .textBackgroundColor)
            Image(systemName: "square.grid.3x3.fill")
                .resizable(resizingMode: .tile)
                .foregroundStyle(.quaternary)
                .opacity(0.12)
        }
    }

    private var iconForUnavailablePreview: String {
        switch row.kind {
        case "FONT": "textformat"
        case "MEDIA": "play.rectangle"
        case "WASM": "cpu"
        default: "doc"
        }
    }

    private var sourceSyntaxKind: String {
        switch row.localFileURL?.pathExtension.lowercased() {
        case "svg", "xml", "html", "htm": "HTML"
        case "css", "scss", "sass", "less": "CSS"
        case "js", "mjs", "cjs", "ts", "tsx", "jsx": "JS"
        default: row.kind
        }
    }
}

private enum AssetPreview {
    case loading
    case image(NSImage)
    case svg(Data)
    case source(String, truncated: Bool, notice: String?)
    case unavailable(String)
}

private enum AssetPreviewLoader {
    private final class CacheEntry: NSObject {
        let preview: AssetPreview

        init(_ preview: AssetPreview) {
            self.preview = preview
        }
    }

    private static let cache: NSCache<NSString, CacheEntry> = {
        let cache = NSCache<NSString, CacheEntry>()
        cache.countLimit = 32
        cache.totalCostLimit = 64 * 1_024 * 1_024
        return cache
    }()

    private static let sourceExtensions: Set<String> = [
        "css", "scss", "sass", "less", "js", "mjs", "cjs", "ts", "tsx", "jsx",
        "html", "htm", "json", "map", "xml", "txt", "md"
    ]
    private static let sourceKinds: Set<String> = ["HTML", "JS", "CSS", "JSON"]
    private static let imageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "heic", "avif", "bmp", "tif", "tiff", "ico"
    ]

    static func load(row: WaterfallRow) async -> AssetPreview {
        guard let fileURL = row.localFileURL else {
            return .unavailable("The captured file is not available locally.")
        }

        let cacheKey = fileURL.path as NSString
        if let cached = cache.object(forKey: cacheKey) {
            return cached.preview
        }

        let preview: AssetPreview = await Task.detached(priority: .userInitiated) { () -> AssetPreview in
            let fileExtension = fileURL.pathExtension.lowercased()

            if fileExtension == "svg" {
                do {
                    let fileSize = (try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                    guard fileSize <= 2 * 1_024 * 1_024 else {
                        return .unavailable("SVG previews are limited to 2 MB.")
                    }
                    let data = try Data(contentsOf: fileURL)
                    if let source = String(data: data, encoding: .utf8), source.contains("[REDACTED]") {
                        return .source(
                            source,
                            truncated: false,
                            notice: "Capture redaction altered this SVG; showing its source instead."
                        )
                    }
                    return .svg(data)
                } catch {
                    return .unavailable("The SVG could not be read.")
                }
            }

            if row.kind == "IMG" || imageExtensions.contains(fileExtension) {
                if let image = thumbnail(for: fileURL) {
                    return .image(image)
                }
                return .unavailable("This image format could not be rendered.")
            }

            if sourceKinds.contains(row.kind) || sourceExtensions.contains(fileExtension) {
                do {
                    let fileSize = (try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                    let data = try readPrefix(of: fileURL, limit: 48 * 1_024)
                    let source = String(decoding: data, as: UTF8.self)
                    return .source(source, truncated: fileSize > data.count, notice: nil)
                } catch {
                    return .unavailable("The source file could not be read.")
                }
            }

            return .unavailable("Open or reveal the file from the row’s context menu.")
        }.value
        cache.setObject(CacheEntry(preview), forKey: cacheKey, cost: cacheCost(for: preview))
        return preview
    }

    private static func cacheCost(for preview: AssetPreview) -> Int {
        switch preview {
        case .image(let image):
            return max(1, Int(image.size.width * image.size.height * 4))
        case .svg(let data):
            return data.count
        case .source(let source, _, _):
            return source.utf8.count
        case .loading, .unavailable:
            return 1
        }
    }

    private static func readPrefix(of url: URL, limit: Int) throws -> Data {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        return try handle.read(upToCount: limit) ?? Data()
    }

    private static func thumbnail(for url: URL) -> NSImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 900
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        return NSImage(cgImage: image, size: .zero)
    }
}

private struct SourcePreviewTextView: NSViewRepresentable {
    let source: String
    let kind: String

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = true

        let textView = NSTextView(frame: .zero)
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = false
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 10, height: 10)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = true
        textView.minSize = .zero
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.textContainer?.containerSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.textContainer?.widthTracksTextView = false
        scrollView.documentView = textView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }
        let highlighted = SyntaxHighlighter.highlight(source, kind: kind)
        guard textView.attributedString() != highlighted else { return }

        textView.textStorage?.setAttributedString(highlighted)
        if let textContainer = textView.textContainer, let layoutManager = textView.layoutManager {
            layoutManager.ensureLayout(for: textContainer)
            let usedRect = layoutManager.usedRect(for: textContainer)
            textView.setFrameSize(NSSize(
                width: max(scrollView.contentSize.width, usedRect.width + 20),
                height: max(scrollView.contentSize.height, usedRect.height + 20)
            ))
        }
    }
}

private enum SyntaxHighlighter {
    private struct Rule {
        let pattern: String
        let color: NSColor
        var options: NSRegularExpression.Options = []
    }

    static func highlight(_ source: String, kind: String) -> NSAttributedString {
        let highlighted = NSMutableAttributedString(
            string: source,
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular),
                .foregroundColor: NSColor.labelColor
            ]
        )

        for rule in rules(for: kind) {
            guard let expression = try? NSRegularExpression(pattern: rule.pattern, options: rule.options) else {
                continue
            }
            let matches = expression.matches(
                in: source,
                range: NSRange(source.startIndex..., in: source)
            )
            for match in matches {
                highlighted.addAttribute(.foregroundColor, value: rule.color, range: match.range)
            }
        }
        return highlighted
    }

    private static func rules(for kind: String) -> [Rule] {
        var rules = [
            Rule(pattern: #"\b(?:true|false|null|undefined|nil)\b"#, color: .systemPurple),
            Rule(pattern: #"\b\d+(?:\.\d+)?\b"#, color: .systemOrange),
            Rule(pattern: #"\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'"#, color: .systemGreen),
            Rule(pattern: #"//[^\n]*|/\*[\s\S]*?\*/"#, color: .secondaryLabelColor)
        ]

        switch kind {
        case "HTML":
            rules.insert(Rule(pattern: #"</?[A-Za-z][A-Za-z0-9:_-]*"#, color: .systemBlue), at: 0)
            rules.append(Rule(pattern: #"<!--[\s\S]*?-->"#, color: .secondaryLabelColor))
        case "CSS":
            rules.insert(
                Rule(pattern: #"(?m)(?:(?<=[;{])[ \t]*[-A-Za-z]+|^[ \t]*[-A-Za-z]+)(?=\s*:)"#, color: .systemBlue),
                at: 0
            )
        case "JS":
            rules.insert(
                Rule(
                    pattern: #"\b(?:async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|switch|throw|try|typeof|var|void|while|yield)\b"#,
                    color: .systemBlue
                ),
                at: 0
            )
        default:
            break
        }
        return rules
    }
}

private struct SVGPreviewWebView: NSViewRepresentable {
    let data: Data

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.underPageBackgroundColor = .clear
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let digest = data.hashValue
        guard context.coordinator.loadedDigest != digest else { return }
        context.coordinator.loadedDigest = digest

        let encoded = data.base64EncodedString()
        let html = """
        <!doctype html>
        <html>
          <head>
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
            <style>
              html, body { width: 100%; height: 100%; margin: 0; background: transparent; }
              body { display: grid; place-items: center; }
              img { max-width: calc(100% - 24px); max-height: calc(100% - 24px); object-fit: contain; }
            </style>
          </head>
          <body><img src="data:image/svg+xml;base64,\(encoded)" alt="SVG preview"></body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    final class Coordinator {
        var loadedDigest: Int?
    }
}
