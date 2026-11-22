import { afterEach, describe, expect, it, vi } from "vitest";
import { PhraseImageCache } from "./phrase-image-cache";

afterEach(() => vi.useRealTimers());
describe("private image memory cache", () => {
  it("shares in-flight requests between prefetch and reveal, and reuses the result", async () => {
    const cache = new PhraseImageCache();
    let resolve: (blob: Blob) => void = () => undefined;
    const fetchBlob = vi.fn(
      () =>
        new Promise<Blob>((done) => {
          resolve = done;
        })
    );
    const first = cache.get("session", "image", fetchBlob);
    expect(cache.get("session", "image", fetchBlob)).toBe(first);
    await Promise.resolve();
    const blob = new Blob(["image"]);
    resolve(blob);
    expect(await first).toBe(blob);
    expect(await cache.get("session", "image", fetchBlob)).toBe(blob);
    expect(fetchBlob).toHaveBeenCalledOnce();
  });
  it("never reuses an image across authentication sessions", async () => {
    const cache = new PhraseImageCache();
    const fetchBlob = vi.fn(async () => new Blob(["image"]));
    await cache.get("account-a", "image", fetchBlob);
    await cache.get("account-b", "image", fetchBlob);
    expect(fetchBlob).toHaveBeenCalledTimes(2);
    cache.clear();
    await cache.get("account-b", "image", fetchBlob);
    expect(fetchBlob).toHaveBeenCalledTimes(3);
  });
  it("aborts pending requests on logout and cannot repopulate the cleared cache", async () => {
    const cache = new PhraseImageCache();
    let resolve: (blob: Blob) => void = () => undefined;
    let signal: AbortSignal | undefined;
    const first = cache.get("old", "image", (requestSignal) => {
      signal = requestSignal;
      return new Promise<Blob>((done) => {
        resolve = done;
      });
    });
    const rejection = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    cache.clear();
    expect(signal?.aborted).toBe(true);
    resolve(new Blob(["old image"]));
    await rejection;
    const fetchBlob = vi.fn(async () => new Blob(["new image"]));
    await cache.get("new", "image", fetchBlob);
    expect(fetchBlob).toHaveBeenCalledOnce();
  });
  it("evicts least recently used images to enforce entry and byte limits", async () => {
    const cache = new PhraseImageCache(6, 2);
    const fetchBlob = vi.fn(async () => new Blob(["123"]));
    await cache.get("s", "a", fetchBlob);
    await cache.get("s", "b", fetchBlob);
    await cache.get("s", "a", fetchBlob);
    await cache.get("s", "c", fetchBlob);
    expect(fetchBlob).toHaveBeenCalledTimes(3);
    await cache.get("s", "a", fetchBlob);
    expect(fetchBlob).toHaveBeenCalledTimes(3);
    await cache.get("s", "b", fetchBlob);
    expect(fetchBlob).toHaveBeenCalledTimes(4);
  });
  it("does not retain blobs exceeding its memory budget", async () => {
    const cache = new PhraseImageCache(2);
    const fetchBlob = vi.fn(async () => new Blob(["123"]));
    await cache.get("s", "a", fetchBlob);
    await cache.get("s", "a", fetchBlob);
    expect(fetchBlob).toHaveBeenCalledTimes(2);
  });
  it("enforces the byte budget before reaching the entry limit", async () => {
    const cache = new PhraseImageCache(5, 10);
    const fetchBlob = vi.fn(async () => new Blob(["123"]));
    await cache.get("s", "a", fetchBlob);
    await cache.get("s", "b", fetchBlob);
    await cache.get("s", "a", fetchBlob);
    expect(fetchBlob).toHaveBeenCalledTimes(3);
  });
  it("expires cached images and retries failed downloads", async () => {
    vi.useFakeTimers();
    const cache = new PhraseImageCache(100, 2, 1000);
    const fetchBlob = vi.fn(async () => new Blob(["image"]));
    await cache.get("s", "a", fetchBlob);
    vi.advanceTimersByTime(1001);
    await cache.get("s", "a", fetchBlob);
    expect(fetchBlob).toHaveBeenCalledTimes(2);
    fetchBlob.mockRejectedValueOnce(new Error("Offline"));
    await expect(cache.get("s", "b", fetchBlob)).rejects.toThrow("Offline");
    await cache.get("s", "b", fetchBlob);
    expect(fetchBlob).toHaveBeenCalledTimes(4);
  });
});
