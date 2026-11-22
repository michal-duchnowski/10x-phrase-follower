import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { APIContext } from "astro";
import { readPhraseImage, readUpload, removePhraseImage, savePhraseImage } from "../lib/phrase-image-storage";
import { POST } from "../pages/api/phrases/[phraseId]/image";
import { GET } from "../pages/api/phrase-images/[phraseId]/[filename]";
import { getSupabaseClient } from "../lib/utils";

vi.mock("../lib/utils", () => ({ getSupabaseClient: vi.fn() }));
const user = "12345678-1234-1234-1234-123456789012";
const phrase = "22345678-1234-1234-1234-123456789012";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "phrase-images-"));
  vi.stubEnv("UPLOADS_DIR", root);
  vi.clearAllMocks();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("private image storage", () => {
  it("rejects a stale wizard preview before reading or saving the image", async () => {
    const update = vi.fn();
    const query = {
      select: () => query,
      eq: () => query,
      update,
      single: async () => ({ data: { id: phrase, image_url: null, updated_at: "new-version" }, error: null }),
    };
    vi.mocked(getSupabaseClient).mockReturnValue({ from: () => query } as unknown as ReturnType<
      typeof getSupabaseClient
    >);
    const response = await POST({
      locals: { userId: user },
      params: { phraseId: phrase },
      request: new Request("http://localhost", {
        method: "POST",
        headers: { "X-Phrase-Version": "old-version" },
        body: "not an image",
      }),
    } as unknown as APIContext);
    expect(response.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });
  it("converts real PNG bytes to a resized WebP and isolates users", async () => {
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    const url = await savePhraseImage(user, phrase, png);
    const bytes = await readPhraseImage(user, url);
    expect(await sharp(bytes).metadata()).toMatchObject({ format: "webp", width: 1600, height: 800 });
    await expect(readPhraseImage(phrase, url)).rejects.toMatchObject({ code: "ENOENT" });
    await removePhraseImage(user, url);
    await expect(readPhraseImage(user, url)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects nonimages and path traversal", async () => {
    await expect(savePhraseImage(user, phrase, Buffer.from("<svg></svg>"))).rejects.toMatchObject({ statusCode: 400 });
    expect(() => readPhraseImage(user, "/api/phrase-images/../../secret")).toThrow("Invalid image path");
  });
  it("enforces upload size without trusting Content-Length", async () => {
    const request = new Request("http://localhost", { method: "POST", body: new Uint8Array(5 * 1024 * 1024 + 1) });
    await expect(readUpload(request)).rejects.toMatchObject({ statusCode: 413 });
  });
  it("requires authentication for upload and download", async () => {
    const context = {
      locals: { userId: null },
      params: { phraseId: phrase },
      request: new Request("http://localhost"),
    } as unknown as APIContext;
    expect((await POST(context)).status).toBe(401);
    expect((await GET(context)).status).toBe(401);
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });
  it("checks ownership before reading an upload body", async () => {
    const eq = vi.fn();
    const query = { select: () => query, eq, single: async () => ({ data: null, error: { code: "PGRST116" } }) };
    eq.mockReturnValue(query);
    vi.mocked(getSupabaseClient).mockReturnValue({ from: () => query } as unknown as ReturnType<
      typeof getSupabaseClient
    >);
    const context = {
      locals: { userId: user },
      params: { phraseId: phrase },
      request: new Request("http://localhost"),
    } as unknown as APIContext;
    expect((await POST(context)).status).toBe(404);
    expect(eq).toHaveBeenCalledWith("notebooks.user_id", user);
  });
  it("replaces an uploaded file after saving its database reference and serves it privately", async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "blue" } })
      .png()
      .toBuffer();
    const previous = await savePhraseImage(user, phrase, png);
    let current = previous;
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      update: (values: { image_url: string }) => {
        current = values.image_url;
        return query;
      },
      single: async () => ({ data: { id: phrase, image_url: current, notebooks: { user_id: user } }, error: null }),
    };
    vi.mocked(getSupabaseClient).mockReturnValue({ from: () => query } as unknown as ReturnType<
      typeof getSupabaseClient
    >);
    const response = await POST({
      locals: { userId: user },
      params: { phraseId: phrase },
      request: new Request("http://localhost", { method: "POST", body: new Uint8Array(png) }),
    } as unknown as APIContext);
    expect(response.status).toBe(200);
    expect((await response.json()).image_url).toBe(current);
    expect(current).not.toBe(previous);
    await expect(readPhraseImage(user, previous)).rejects.toMatchObject({ code: "ENOENT" });
    const download = await GET({
      locals: { userId: user },
      params: { phraseId: phrase, filename: current.split("/").pop() },
    } as unknown as APIContext);
    expect(download.status).toBe(200);
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(download.headers.get("content-type")).toBe("image/webp");
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
