import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import PhraseImage from "../components/PhraseImage";
import { normalizeImageUrl, isValidImageDimension } from "./phrase-image";

const image = "https://images.example.com/photo?id=42&size=original";

afterEach(() => vi.restoreAllMocks());

describe("phrase images", () => {
  it("accepts direct image URLs with query strings and trims whitespace", () => {
    expect(normalizeImageUrl(`  ${image}  `)).toBe(image);
  });
  it.each([null, "", "   "])("clears a link with %s", (value) => {
    expect(normalizeImageUrl(value)).toBeNull();
  });
  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,abc",
    "file:///photo.png",
    "http://example.com/a.jpg",
    "https://user:pass@example.com/a.jpg",
    "/image.jpg",
    4,
    {},
  ])("rejects unsafe or invalid links: %s", (value) => {
    expect(() => normalizeImageUrl(value)).toThrow();
  });
  it("rejects oversized URLs", () => {
    expect(() => normalizeImageUrl(`https://example.com/${"x".repeat(4096)}`)).toThrow();
  });
  it("renders no image or preload before the answer is revealed", () => {
    expect(renderToStaticMarkup(createElement(PhraseImage, { url: image, revealed: false }))).toBe("");
    expect(renderToStaticMarkup(createElement(PhraseImage, { url: null, revealed: true }))).toBe("");
  });
  it("limits image dimensions without forcing a size or cropping, and omits the referrer", () => {
    const html = renderToStaticMarkup(
      createElement(PhraseImage, { url: image, revealed: true, maxWidth: 300, maxHeight: 200 })
    );
    expect(html).toContain("max-width:min(100%, 300px)");
    expect(html).toContain("max-height:200px");
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain("object-contain");
    expect(html).not.toMatch(/\s(?:width|height)="/);
  });
  it("validates user size settings, including fractional and out-of-range sizes", () => {
    expect(isValidImageDimension(120, "width")).toBe(true);
    expect(isValidImageDimension(480, "width")).toBe(true);
    expect(isValidImageDimension(90, "height")).toBe(true);
    expect(isValidImageDimension(360, "height")).toBe(true);
    expect(isValidImageDimension(119, "width")).toBe(false);
    expect(isValidImageDimension(361, "height")).toBe(false);
    expect(isValidImageDimension(240.5, "width")).toBe(false);
    expect(isValidImageDimension("240", "width")).toBe(false);
  });
});
