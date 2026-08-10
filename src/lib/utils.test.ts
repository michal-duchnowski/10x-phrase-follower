import { describe, expect, it } from "vitest";
import { parseMarkdownToHtml } from "./utils";

describe("markdown preview", () => {
  it("renders italic, bold, and combined emphasis", () => {
    expect(parseMarkdownToHtml("*italic*")).toBe("<p><em>italic</em></p>");
    expect(parseMarkdownToHtml("**bold**")).toBe("<p><strong>bold</strong></p>");
    expect(parseMarkdownToHtml("***both***")).toBe("<p><strong><em>both</em></strong></p>");
  });
});
