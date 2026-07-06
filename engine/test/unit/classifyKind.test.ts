import { describe, expect, it } from "vitest";
import { classifyKind } from "../../src/assets/classifyKind";

describe("classifyKind", () => {
  it.each([
    ["https://example.com/", "text/html; charset=utf-8", "HTML"],
    ["https://example.com/app", "application/javascript", "JS"],
    ["https://example.com/app", "text/javascript; charset=utf-8", "JS"],
    ["https://example.com/styles", "text/css", "CSS"],
    ["https://example.com/logo", "image/png", "IMG"],
    ["https://example.com/font", "font/woff2", "FONT"],
    ["https://example.com/font", "application/font-woff2", "FONT"],
    ["https://example.com/data", "application/json", "JSON"],
    ["https://example.com/song", "audio/mpeg", "MEDIA"],
    ["https://example.com/movie", "video/mp4", "MEDIA"],
    ["https://example.com/module", "application/wasm", "WASM"]
  ])("classifies %s with %s as %s", (url, contentType, expected) => {
    expect(classifyKind(url, contentType)).toBe(expected);
  });

  it.each([
    ["https://example.com/index.html", null, "HTML"],
    ["https://example.com/app.mjs", "application/octet-stream", "JS"],
    ["https://example.com/app.js", undefined, "JS"],
    ["https://example.com/styles.css", undefined, "CSS"],
    ["https://example.com/logo.webp", undefined, "IMG"],
    ["https://example.com/font.woff2", undefined, "FONT"],
    ["https://example.com/data.json", undefined, "JSON"],
    ["https://example.com/movie.webm", undefined, "MEDIA"],
    ["https://example.com/module.wasm", undefined, "WASM"]
  ])("falls back to the %s extension as %s", (url, contentType, expected) => {
    expect(classifyKind(url, contentType)).toBe(expected);
  });

  it("returns OTHER for unknown content types and extensions", () => {
    expect(classifyKind("https://example.com/download.bin", "application/octet-stream")).toBe("OTHER");
  });
});
