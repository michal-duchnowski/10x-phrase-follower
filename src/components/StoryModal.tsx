import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, X } from "lucide-react";
import { parseMarkdownToHtml } from "../lib/utils";
import { useApi } from "../lib/hooks/useApi";
import { Button } from "./ui/button";

interface StoryModalProps {
  open: boolean;
  phraseIds: string[];
  onClose: () => void;
}
interface StoryContent {
  content: string;
}

export default function StoryModal({ open, phraseIds, onClose }: StoryModalProps) {
  const { apiCall } = useApi();
  const [story, setStory] = useState<StoryContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall<StoryContent>("/api/stories/generate", {
        method: "POST",
        body: JSON.stringify({ phrase_ids: phraseIds }),
      });
      setStory(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a story.");
    } finally {
      setLoading(false);
    }
  }, [apiCall, phraseIds]);

  useEffect(() => {
    if (!open) return;
    setStory(null);
    setError(null);
    void generate();
  }, [generate, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => event.key === "Escape" && !loading && onClose();
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, onClose, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 px-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="AI exercise"
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-card shadow-lg sm:h-auto sm:max-h-[80vh] sm:max-w-2xl sm:rounded-lg sm:border sm:border-border"
      >
        <header className="hidden items-start justify-between gap-4 border-b border-border px-4 py-3 sm:flex">
          <div>
            <h2 id="story-title" className="text-base font-semibold">
              Your AI exercise
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Generated from {phraseIds.length} selected expressions.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading && (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Creating a memorable story...
            </div>
          )}
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {!loading && story && (
            <div
              className="markdown-content text-base leading-7 text-foreground sm:text-sm"
              dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(story.content) }}
            />
          )}
        </main>
        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button onClick={onClose} disabled={loading}>
            Close
          </Button>
          <Button onClick={() => void generate()} disabled={loading}>
            <RefreshCw className="size-4" /> Generate another
          </Button>
        </footer>
      </section>
    </div>
  );
}
