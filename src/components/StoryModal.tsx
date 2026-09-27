import { useCallback, useEffect, useRef, useState } from "react";
import { Languages, LoaderCircle, RefreshCw, Volume2, X } from "lucide-react";
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

interface TranslationResult {
  translation: string;
}

const MAX_TRANSLATION_SELECTION_LENGTH = 4_000;

export default function StoryModal({ open, phraseIds, onClose }: StoryModalProps) {
  const { apiCall } = useApi();
  const [story, setStory] = useState<StoryContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [retryPlaybackRequired, setRetryPlaybackRequired] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [selectionPosition, setSelectionPosition] = useState<{ top: number; left: number } | null>(null);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const storyContentRef = useRef<HTMLDivElement | null>(null);
  const isOpenRef = useRef(open);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    setRetryPlaybackRequired(false);
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audioRef.current = null;
  }, []);

  const closeStory = useCallback(() => {
    stopAudio();
    onClose();
  }, [onClose, stopAudio]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    stopAudio();
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
  }, [apiCall, phraseIds, stopAudio]);

  const playStory = useCallback(async () => {
    if (!story) return;
    setAudioLoading(true);
    setError(null);
    stopAudio();
    try {
      const result = await apiCall<{ url: string }>("/api/stories/audio", {
        method: "POST",
        body: JSON.stringify({ content: story.content }),
      });
      const nextAudio = new Audio(result.url);
      if (!isOpenRef.current) return;
      nextAudio.preload = "auto";
      audioRef.current = nextAudio;
      try {
        await nextAudio.play();
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setRetryPlaybackRequired(true);
          setError("Audio is ready. Tap the speaker again to play it.");
          return;
        }
        stopAudio();
        throw err;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not play story audio.");
    } finally {
      setAudioLoading(false);
    }
  }, [apiCall, stopAudio, story]);

  const playPreparedStory = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    setRetryPlaybackRequired(false);
    // Call play synchronously in the click handler. Browser autoplay policies,
    // especially on iOS, can reject playback after an awaited API request.
    void audio.play().catch((err: unknown) => {
      setRetryPlaybackRequired(true);
      setError(err instanceof Error ? err.message : "Could not play story audio.");
    });
  }, []);

  const clearTranslation = useCallback(() => {
    setSelectedText("");
    setSelectionPosition(null);
    setTranslation(null);
    setTranslationError(null);
  }, []);

  const captureSelection = useCallback(() => {
    const selection = window.getSelection();
    const storyContent = storyContentRef.current;
    if (!selection || selection.rangeCount === 0 || !storyContent) {
      clearTranslation();
      return;
    }

    const range = selection.getRangeAt(0);
    if (!storyContent.contains(range.commonAncestorContainer)) {
      clearTranslation();
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      clearTranslation();
      return;
    }

    const rect = range.getBoundingClientRect();
    setSelectedText(text);
    setTranslation(null);
    setTranslationError(null);
    setSelectionPosition({ top: Math.max(12, rect.top - 44), left: Math.max(12, rect.left + rect.width / 2) });
  }, [clearTranslation]);

  const translateSelection = useCallback(async () => {
    if (!selectedText) return;
    if (selectedText.length > MAX_TRANSLATION_SELECTION_LENGTH) {
      setTranslationError(
        `Select up to ${MAX_TRANSLATION_SELECTION_LENGTH.toLocaleString("en-US")} characters at a time.`
      );
      return;
    }

    setTranslationLoading(true);
    setTranslationError(null);
    setTranslation(null);
    try {
      const result = await apiCall<TranslationResult>("/api/stories/translate", {
        method: "POST",
        body: JSON.stringify({ text: selectedText }),
      });
      setTranslation(result.translation);
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : "Could not translate the selected text.");
    } finally {
      setTranslationLoading(false);
    }
  }, [apiCall, selectedText]);

  useEffect(() => {
    isOpenRef.current = open;
    if (!open) {
      stopAudio();
      return;
    }
    setStory(null);
    setError(null);
    clearTranslation();
    stopAudio();
    void generate();
  }, [clearTranslation, generate, open, stopAudio]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  useEffect(() => {
    if (!open || !story) return;
    document.addEventListener("selectionchange", captureSelection);
    return () => document.removeEventListener("selectionchange", captureSelection);
  }, [captureSelection, open, story]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => event.key === "Escape" && !loading && closeStory();
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeStory, loading, open]);

  if (!open) return null;
  const translationPanelStyle =
    typeof window !== "undefined" && window.innerWidth >= 640 && selectionPosition
      ? {
          top: Math.min(selectionPosition.top + 42, window.innerHeight - 310),
          left: Math.min(Math.max(16, selectionPosition.left - 180), window.innerWidth - 464),
        }
      : undefined;

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
            onClick={closeStory}
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
              ref={storyContentRef}
              className="markdown-content text-base leading-7 text-foreground sm:text-sm"
              dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(story.content) }}
            />
          )}
        </main>
        {selectedText && selectionPosition && !translation && !translationLoading && !translationError && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void translateSelection()}
            className="fixed z-[60] inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-lg sm:py-1.5"
            style={{ top: selectionPosition.top, left: selectionPosition.left }}
            aria-label="Translate selected text into Polish"
          >
            <Languages className="size-4" /> Translate
          </button>
        )}
        {(translationLoading || translation || translationError) && (
          <div
            className="fixed inset-x-0 bottom-0 z-[60] max-h-[55dvh] overflow-y-auto rounded-t-xl border border-border bg-card p-4 shadow-2xl sm:inset-x-auto sm:bottom-auto sm:max-h-72 sm:w-[min(28rem,calc(100vw-2rem))] sm:rounded-xl"
            style={translationPanelStyle}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                <Languages className="size-4" /> Polish translation
              </span>
              <button
                type="button"
                onClick={clearTranslation}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close translation"
              >
                <X className="size-4" />
              </button>
            </div>
            {translationLoading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" /> Translating...
              </p>
            )}
            {translationError && (
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-destructive">{translationError}</p>
                <Button size="sm" variant="outline" onClick={() => void translateSelection()}>
                  Retry
                </Button>
              </div>
            )}
            {translation && <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{translation}</p>}
          </div>
        )}
        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button onClick={closeStory} disabled={loading || audioLoading}>
            Close
          </Button>
          <Button
            onClick={() => (retryPlaybackRequired ? playPreparedStory() : void playStory())}
            disabled={loading || audioLoading || !story}
            size="icon"
            aria-label="Play English story"
            title={retryPlaybackRequired ? "Tap again to play the prepared story audio" : "Play English story"}
          >
            {audioLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Volume2 className="size-4" />}
          </Button>
          <Button onClick={() => void generate()} disabled={loading}>
            <RefreshCw className="size-4" /> Generate another
          </Button>
        </footer>
      </section>
    </div>
  );
}
