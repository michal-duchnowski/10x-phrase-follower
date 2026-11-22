import { describe, expect, it, vi, afterEach } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  compressIllustration,
  illustrationPrompt,
  parseIllustrationMapping,
  readIllustrationZip,
  uniqueIllustrationPhrases,
  MAX_ZIP_BYTES,
} from "./illustration-import";

const id = "550e8400-e29b-41d4-a716-446655440000";
const other = "550e8400-e29b-41d4-a716-446655440001";
const mapping = (images: unknown[]) => "```json\n" + JSON.stringify({ version: 1, images }) + "\n```";
const zip = (entries: Record<string, Uint8Array>) => new File([zipSync(entries)], "illustrations.zip");
afterEach(() => vi.unstubAllGlobals());

describe("illustration import", () => {
  it("preserves multiline Markdown and deduplicates learning directions by phrase ID", () => {
    const phrase = { id, en_text: '**Ice**\n"quoted" | sentence', pl_text: "Lód" };
    expect(uniqueIllustrationPhrases([phrase, phrase])).toHaveLength(1);
    const prompt = illustrationPrompt([phrase, phrase]);
    expect(prompt).toContain("Styl: Różnorodne, kwadratowe ilustracje.");
    expect(illustrationPrompt([phrase], "Akwarele")).toContain("Styl: Akwarele");
    const payload = JSON.parse(prompt.split("Fiszki:\n")[1]);
    expect(payload).toEqual([{ id, en: phrase.en_text, pl: phrase.pl_text }]);
  });
  it("maps by IDs independently of text and order", () => {
    expect(
      parseIllustrationMapping(
        mapping([
          { id: other, file: "images/b.png" },
          { id, file: "a.webp" },
        ]),
        new Set([id, other])
      )
    ).toHaveLength(2);
  });
  it.each([
    [{ id: other, file: "a.png" }],
    [{ id, file: "../a.png" }],
    [{ id, file: "C:/a.png" }],
    [{ id, file: "a.svg" }],
    [
      { id, file: "a.png" },
      { id, file: "b.png" },
    ],
    [
      { id, file: "a.png" },
      { id: other, file: "a.png" },
    ],
  ])("rejects unknown IDs, unsafe paths and duplicates: %j", (...items) => {
    expect(() => parseIllustrationMapping(mapping(items), new Set([id]))).toThrow();
  });
  it("reads an actual deflated ZIP locally", async () => {
    const text = mapping([{ id, file: "images/a.png" }]);
    const result = await readIllustrationZip(
      zip({ "mapping.md": strToU8(text), "images/a.png": new Uint8Array([1, 2, 3]) })
    );
    expect(result.mapping).toBe(text);
    expect(result.files.get("images/a.png")).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("accepts a real 50 MiB ZIP without sending the archive to the server", async () => {
    const image = new Uint8Array(25 * 1024 * 1024);
    const bytes = zipSync({ "mapping.md": strToU8(mapping([])), "a.png": image, "b.png": image }, { level: 0 });
    expect(bytes.length).toBeGreaterThan(50 * 1024 * 1024);
    const result = await readIllustrationZip(new File([bytes], "large.zip"));
    expect(result.files.get("a.png")?.length).toBe(image.length);
    expect(result.files.get("b.png")?.length).toBe(image.length);
  });
  it("rejects missing manifests and oversized archives/entries", async () => {
    await expect(readIllustrationZip(zip({ "a.png": new Uint8Array([1]) }))).rejects.toThrow("mapping.md");
    await expect(readIllustrationZip({ size: MAX_ZIP_BYTES + 1 } as File)).rejects.toThrow("100 MiB");
    await expect(readIllustrationZip(zip({ "mapping.md": new Uint8Array(256 * 1024 + 1) }))).rejects.toThrow(
      "too large"
    );
  });
  it("resizes and encodes before upload, then releases the bitmap", async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const bitmap = { width: 3200, height: 1600, close };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: (blob: Blob) => void, type: string, quality: number) => {
        expect(type).toBe("image/webp");
        expect(quality).toBe(0.82);
        callback(new Blob(["compressed"], { type }));
      },
    };
    vi.stubGlobal("createImageBitmap", async () => bitmap);
    vi.stubGlobal("document", { createElement: () => canvas });
    expect((await compressIllustration(new Uint8Array([1]), "a.png")).type).toBe("image/webp");
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(800);
    expect(drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
