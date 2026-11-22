interface CacheEntry {
  blob: Blob;
  expiresAt: number;
}

/** Private, bounded cache for this page's authenticated session. Never persisted. */
export class PhraseImageCache {
  private scope: string | null = null;
  private generation = 0;
  private bytes = 0;
  private entries = new Map<string, CacheEntry>();
  private pending = new Map<string, { promise: Promise<Blob>; controller: AbortController }>();

  constructor(
    private readonly maxBytes = 32 * 1024 * 1024,
    private readonly maxEntries = 32,
    private readonly ttlMs = 10 * 60 * 1000
  ) {}

  setScope(scope: string | null): void {
    if (this.scope === scope) return;
    this.clear();
    this.scope = scope;
  }

  clear(): void {
    this.generation++;
    for (const entry of this.pending.values()) entry.controller.abort();
    this.pending.clear();
    this.entries.clear();
    this.bytes = 0;
    this.scope = null;
  }

  invalidate(scope: string | null, url: string): void {
    if (scope !== this.scope) return;
    const entry = this.entries.get(url);
    if (entry) this.bytes -= entry.blob.size;
    this.entries.delete(url);
    this.pending.get(url)?.controller.abort();
    this.pending.delete(url);
  }

  get(scope: string, url: string, fetchBlob: (signal: AbortSignal) => Promise<Blob>): Promise<Blob> {
    this.setScope(scope);
    const cached = this.entries.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      this.entries.delete(url);
      this.entries.set(url, cached);
      return Promise.resolve(cached.blob);
    }
    if (cached) this.invalidate(scope, url);
    const pending = this.pending.get(url);
    if (pending) return pending.promise;

    const controller = new AbortController();
    const generation = this.generation;
    const promise = Promise.resolve()
      .then(() => fetchBlob(controller.signal))
      .then((blob) => {
        if (controller.signal.aborted || generation !== this.generation)
          throw new DOMException("Session changed", "AbortError");
        if (blob.size <= this.maxBytes) {
          this.entries.set(url, { blob, expiresAt: Date.now() + this.ttlMs });
          this.bytes += blob.size;
          while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.invalidate(scope, oldest);
          }
        }
        return blob;
      })
      .finally(() => {
        if (this.pending.get(url)?.controller === controller) this.pending.delete(url);
      });
    this.pending.set(url, { promise, controller });
    return promise;
  }
}

export const phraseImageCache = new PhraseImageCache();

export function fetchCachedPhraseImage(
  scope: string,
  url: string,
  apiFetch: (url: string, options: RequestInit) => Promise<Response>
) {
  return phraseImageCache.get(scope, url, async (signal) => {
    const response = await apiFetch(url, { signal, headers: { Accept: "image/webp" } });
    if (!response.ok) throw new Error("Image unavailable");
    return response.blob();
  });
}
