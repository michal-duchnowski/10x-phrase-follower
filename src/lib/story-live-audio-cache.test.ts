import { describe, expect, it } from "vitest";
import { StoryLiveAudioMemoryCache } from "./story-live-audio-cache";

describe("StoryLiveAudioMemoryCache", () => {
  it("joins completed PCM chunks and expires them after ten minutes", () => {
    const cache = new StoryLiveAudioMemoryCache();
    cache.set("story", [Uint8Array.from([1, 2]), Uint8Array.from([3, 4])], 1_000);

    expect(cache.get("story", 1_000)).toEqual(Uint8Array.from([1, 2, 3, 4]));
    expect(cache.get("story", 1_000 + 10 * 60 * 1_000)).toBeNull();
  });

  it("keeps at most the three most recently used stories", () => {
    const cache = new StoryLiveAudioMemoryCache();
    cache.set("one", [Uint8Array.of(1)], 1);
    cache.set("two", [Uint8Array.of(2)], 2);
    cache.set("three", [Uint8Array.of(3)], 3);
    expect(cache.get("one", 4)).toEqual(Uint8Array.of(1));
    cache.set("four", [Uint8Array.of(4)], 5);

    expect(cache.get("two", 5)).toBeNull();
    expect(cache.get("one", 5)).toEqual(Uint8Array.of(1));
    expect(cache.get("three", 5)).toEqual(Uint8Array.of(3));
    expect(cache.get("four", 5)).toEqual(Uint8Array.of(4));
  });

  it("does not store an incomplete empty stream and can be cleared", () => {
    const cache = new StoryLiveAudioMemoryCache();
    cache.set("empty", []);
    expect(cache.get("empty")).toBeNull();

    cache.set("story", [Uint8Array.of(1)]);
    cache.clear();
    expect(cache.get("story")).toBeNull();
  });
});
