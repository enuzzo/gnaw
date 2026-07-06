export type AssetKind = "HTML" | "JS" | "CSS" | "IMG" | "FONT" | "JSON" | "MEDIA" | "WASM" | "OTHER";

const extensionKinds = new Map<string, AssetKind>([
  [".html", "HTML"],
  [".htm", "HTML"],
  [".js", "JS"],
  [".mjs", "JS"],
  [".cjs", "JS"],
  [".css", "CSS"],
  [".png", "IMG"],
  [".jpg", "IMG"],
  [".jpeg", "IMG"],
  [".gif", "IMG"],
  [".webp", "IMG"],
  [".svg", "IMG"],
  [".avif", "IMG"],
  [".ico", "IMG"],
  [".woff", "FONT"],
  [".woff2", "FONT"],
  [".ttf", "FONT"],
  [".otf", "FONT"],
  [".eot", "FONT"],
  [".json", "JSON"],
  [".map", "JSON"],
  [".mp3", "MEDIA"],
  [".mp4", "MEDIA"],
  [".m4a", "MEDIA"],
  [".webm", "MEDIA"],
  [".ogg", "MEDIA"],
  [".wav", "MEDIA"],
  [".wasm", "WASM"]
]);

export function classifyKind(url: string, contentType?: string | null): AssetKind {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";

  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") return "HTML";
  if (
    mediaType === "application/javascript" ||
    mediaType === "text/javascript" ||
    mediaType === "application/ecmascript" ||
    mediaType === "text/ecmascript" ||
    mediaType === "application/x-javascript"
  ) {
    return "JS";
  }
  if (mediaType === "text/css") return "CSS";
  if (mediaType.startsWith("image/")) return "IMG";
  if (mediaType.startsWith("font/") || mediaType.includes("font") || mediaType.includes("woff")) return "FONT";
  if (mediaType === "application/json" || mediaType.endsWith("+json")) return "JSON";
  if (mediaType.startsWith("audio/") || mediaType.startsWith("video/")) return "MEDIA";
  if (mediaType === "application/wasm") return "WASM";

  return extensionKinds.get(extractExtension(url)) ?? "OTHER";
}

function extractExtension(url: string): string {
  try {
    return extensionFromPathname(new URL(url).pathname);
  } catch {
    return extensionFromPathname(url.split(/[?#]/, 1)[0] ?? "");
  }
}

function extensionFromPathname(pathname: string): string {
  const fileName = pathname.split("/").pop() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > -1 ? fileName.slice(dotIndex).toLowerCase() : "";
}
