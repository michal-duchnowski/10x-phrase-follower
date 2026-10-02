const LIVE_AUDIO_CACHE_TTL_MS = 10 * 60 * 1_000;
const LIVE_AUDIO_CACHE_MAX_ENTRIES = 3;

interface CacheEntry {
  audio: Uint8Array;
  expiresAt: number;
  lastAccessedAt: number;
}

export class StoryLiveAudioMemoryCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(key: string, now = Date.now()): Uint8Array | null {
    this.removeExpired(now);
    const entry = this.entries.get(key);
    if (!entry) return null;
    entry.lastAccessedAt = now;
    return entry.audio;
  }

  set(key: string, chunks: readonly Uint8Array[], now = Date.now()): void {
    const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    if (byteLength === 0) return;

    const audio = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk, offset);
      offset += chunk.byteLength;
    }

    this.removeExpired(now);
    this.entries.set(key, { audio, expiresAt: now + LIVE_AUDIO_CACHE_TTL_MS, lastAccessedAt: now });
    while (this.entries.size > LIVE_AUDIO_CACHE_MAX_ENTRIES) {
      let oldestKey: string | null = null;
      let oldestAccess = Number.POSITIVE_INFINITY;
      for (const [entryKey, entry] of this.entries) {
        if (entry.lastAccessedAt < oldestAccess) {
          oldestKey = entryKey;
          oldestAccess = entry.lastAccessedAt;
        }
      }
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private removeExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

export const storyLiveAudioCache = new StoryLiveAudioMemoryCache();
