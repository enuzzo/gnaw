import { describe, expect, it } from "vitest";
import { detectStack } from "../../src/stack/detectStack";

describe("stack detection", () => {
  it("detects Next.js from serialized data", () => {
    const stack = detectStack({
      html: '<script id="__NEXT_DATA__" type="application/json">{}</script>',
      assetUrls: []
    });

    expect(stack.primary).toBe("Next.js");
    expect(stack.detected[0]).toMatchObject({
      name: "Next.js",
      confidence: 0.92
    });
  });

  it("detects WordPress and Elementor signals", () => {
    const stack = detectStack({
      html: '<body class="home page-template-default"><article class="elementor elementor-101"></article></body>',
      assetUrls: ["http://127.0.0.1:43112/wp-content/uploads/hero-placeholder.svg"]
    });

    expect(stack.primary).toBe("WordPress");
    expect(stack.detected.map((item) => item.name)).toEqual(["WordPress", "Elementor"]);
  });

  it("leaves unknown static pages unset", () => {
    expect(detectStack({ html: "<h1>Static</h1>", assetUrls: [] })).toEqual({
      primary: null,
      detected: []
    });
  });

  it("detects header and platform signals", () => {
    expect(detectStack({ html: "", assetUrls: [], headers: { server: "Vercel" } }).primary).toBe("Vercel");
    expect(detectStack({ html: '<html data-wf-page="abc"></html>', assetUrls: [] }).primary).toBe("Webflow");
    expect(detectStack({ html: "<script>window.Shopify = {}</script>", assetUrls: [] }).primary).toBe("Shopify");
  });
});
