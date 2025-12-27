import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  PlaybackManifestVM,
  PlaybackManifestDTO,
  PlaybackManifestItem,
  PlaybackManifestSegment,
  WordTiming,
  VoiceSlot,
  PlaybackSpeed,
  PhraseDifficultyOrUnset,
  PhraseDifficulty,
} from "../types";
import PlayerControls from "./PlayerControls";
import SegmentSequenceBar from "./SegmentSequenceBar";
import PhraseViewer from "./PhraseViewer";
import KeyboardShortcutsHandler from "./KeyboardShortcutsHandler";
import RefreshManifestButton from "./RefreshManifestButton";
import { Button } from "./ui/button";
import { usePlaybackEngine } from "../lib/hooks/usePlaybackEngine";
import { useSignedUrlGuard } from "../lib/hooks/useSignedUrlGuard";
import { useClickToSeek } from "../lib/hooks/useClickToSeek";
import { useAuth } from "../lib/hooks/useAuth";
import { useApi } from "../lib/hooks/useApi";
import MobileActionMenu from "./MobileActionMenu";
import DifficultyBadge from "./DifficultyBadge";

interface PlayerShellProps {
  notebookId: string;
  startPhraseId?: string;
  difficultyFilter?: string;
}

export default function PlayerShell({
  notebookId,
  startPhraseId,
  difficultyFilter: initialDifficultyFilter,
}: PlayerShellProps) {
  // Authentication
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { apiCall } = useApi();

  // Core state
  const [manifest, setManifest] = useState<PlaybackManifestVM | null>(null);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [currentSlot, setCurrentSlot] = useState<VoiceSlot | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [highlight, setHighlight] = useState(true);
  const [, setClockMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  // Get difficulty filter from props (URL params) - no localStorage fallback
  const difficultyFilter: PhraseDifficultyOrUnset | "all" =
    initialDifficultyFilter &&
    (initialDifficultyFilter === "all" ||
      initialDifficultyFilter === "unset" ||
      initialDifficultyFilter === "easy" ||
      initialDifficultyFilter === "medium" ||
      initialDifficultyFilter === "hard")
      ? (initialDifficultyFilter as PhraseDifficultyOrUnset | "all")
      : "all";
  const toastRef = useRef<{ show: (message: string) => void } | null>(null);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Find initial phrase index from startPhraseId
  useEffect(() => {
    if (manifest && startPhraseId) {
      const index = manifest.sequence.findIndex((item) => item.phrase.id === startPhraseId);
      if (index !== -1) {
        setPhraseIndex(index);
      }
    }
  }, [manifest, startPhraseId]);

  // Fetch playback manifest
  const fetchManifest = useCallback(async () => {
    if (!isAuthenticated) {
      setError("Authentication required");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      let manifestUrl = `/api/notebooks/${notebookId}/playback-manifest?highlight=${highlight ? "on" : "off"}&speed=${speed}`;
      if (difficultyFilter !== "all") {
        manifestUrl += `&difficulty=${difficultyFilter}`;
      }
      const data = await apiCall<PlaybackManifestDTO>(manifestUrl);

      // eslint-disable-next-line no-console
      console.log("[PlayerShell] Playback manifest loaded:", data);

      // Transform DTO to VM
      const manifestVM: PlaybackManifestVM = {
        notebookId: data.notebook_id,
        buildId: data.build_id,
        sequence: data.sequence.map((item: PlaybackManifestItem) => ({
          phrase: {
            id: item.phrase.id,
            position: item.phrase.position,
            en_text: item.phrase.en_text,
            pl_text: item.phrase.pl_text,
            difficulty: item.phrase.difficulty,
            tokens: {
              en:
                item.phrase.tokens?.en?.map((t) => ({
                  text: t.text,
                  charStart: t.start,
                  charEnd: t.end,
                })) || [],
              pl:
                item.phrase.tokens?.pl?.map((t) => ({
                  text: t.text,
                  charStart: t.start,
                  charEnd: t.end,
                })) || [],
            },
          },
          segments: item.segments.map((segment: PlaybackManifestSegment) => ({
            slot: segment.slot,
            status: segment.status,
            url: segment.url,
            durationMs: segment.duration_ms,
            timings: segment.word_timings
              ?.filter((wt): wt is WordTiming => wt !== undefined)
              .map((wt: WordTiming) => ({
                startMs: wt.start_ms,
                endMs: wt.end_ms,
              })),
          })),
        })),
        expiresAt: data.expires_at,
      };

      setManifest(manifestVM);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[PlayerShell] Failed to fetch playback manifest:", err);
      setError(err instanceof Error ? err.message : "Failed to load playback manifest");
    } finally {
      setLoading(false);
    }
  }, [notebookId, highlight, speed, difficultyFilter, isAuthenticated, apiCall]);

  // Initial manifest fetch
  useEffect(() => {
    fetchManifest();
  }, [fetchManifest]);

  // URL expiry guard
  const { needsRefresh } = useSignedUrlGuard({ expiresAt: manifest?.expiresAt });

  // Current phrase and segments
  const currentPhrase = manifest?.sequence[phraseIndex];
  const currentSegments = useMemo(() => currentPhrase?.segments || [], [currentPhrase?.segments]);
  const hasPlayableSegments = currentSegments.length > 0;

  // Playback engine
  const {
    onAdvanceNext,
    onAdvancePrev,
    playSegment,
    pausePlayback,
    resumePlayback,
    stopPlayback,
    seekSmall,
    seekLarge,
    getAudioElement,
  } = usePlaybackEngine({
    manifest,
    phraseIndex,
    speed,
    setCurrentSlot,
    setClockMs,
    setPhraseIndex,
  });

  // Handle playing state - start audio playback when playing becomes true
  useEffect(() => {
    if (playing && currentSegments.length > 0 && !currentSlot) {
      // Find the first available segment to start with (EN1)
      const firstSegment = currentSegments.find((s) => s.slot === "EN1" && s.url);
      if (firstSegment && firstSegment.url) {
        playSegment("EN1", firstSegment.url);
      } else {
        // Show toast if no playable segments
        if (toastRef.current) {
          toastRef.current.show("Brak dostępnych segmentów – pomijam frazę");
        }
        setPlaying(false);
      }
    }
  }, [playing, currentSegments, currentSlot, playSegment]);

  // Click-to-seek functionality
  const currentSegmentTimings = currentSegments.find((s) => s.slot === currentSlot)?.timings;
  const tokenTimings: { word: string; startMs: number; endMs: number }[] | undefined = currentSegmentTimings
    ?.filter((t): t is { startMs: number; endMs: number } => t !== undefined)
    .map((t) => ({
      word: "",
      startMs: t.startMs,
      endMs: t.endMs,
    }));

  const { seekToToken } = useClickToSeek({
    tokens: currentPhrase?.phrase.tokens,
    timings: tokenTimings,
    getAudioElement,
  });

  // Event handlers
  const handlePlay = useCallback(() => {
    if (!hasPlayableSegments) {
      if (toastRef.current) {
        toastRef.current.show("Brak dostępnych segmentów – pomijam frazę");
      }
      return;
    }
    if (currentSlot) {
      resumePlayback();
      setPlaying(true);
      return;
    }
    setPlaying(true);
  }, [hasPlayableSegments, currentSlot, resumePlayback]);

  const handlePause = useCallback(() => {
    setPlaying(false);
    pausePlayback();
  }, [pausePlayback]);

  const handleStop = useCallback(() => {
    setPlaying(false);
    stopPlayback();
  }, [stopPlayback]);

  const handleRestartPhrase = useCallback(() => {
    setClockMs(0);
    setCurrentSlot(null);
    setPlaying(true);
  }, []);

  const handleSpeedChange = useCallback((newSpeed: PlaybackSpeed) => {
    setSpeed(newSpeed);
  }, []);

  const handleToggleHighlight = useCallback(() => {
    setHighlight((prev) => !prev);
  }, []);

  const handleSeekToToken = useCallback(
    (tokenIndex: number, language: "en" | "pl") => {
      // If clicking EN while PL is active, restart from EN1
      if (currentSlot === "PL" && language === "en") {
        const en1Segment = currentSegments.find((s) => s.slot === "EN1");
        if (en1Segment && en1Segment.url) {
          setCurrentSlot("EN1");
          setClockMs(0);
          playSegment("EN1", en1Segment.url);
          setPlaying(true);
        }
        return;
      }

      // Only allow seeking in active segment
      if (currentSlot && seekToToken) {
        const activeLang = currentSlot === "PL" ? "pl" : "en";
        if (activeLang === language) {
          seekToToken(tokenIndex);
        }
      } else if (!currentSlot && language === "en") {
        // If no segment is active and clicking EN, start from EN1
        const en1Segment = currentSegments.find((s) => s.slot === "EN1");
        if (en1Segment && en1Segment.url) {
          setCurrentSlot("EN1");
          setClockMs(0);
          playSegment("EN1", en1Segment.url);
          setPlaying(true);
        }
      }
    },
    [currentSlot, seekToToken, currentSegments, playSegment]
  );

  const handleJumpToSlot = useCallback(
    (slot: VoiceSlot) => {
      const segment = currentSegments.find((s) => s.slot === slot);
      if (segment && segment.url) {
        setCurrentSlot(slot);
        setClockMs(0);
        playSegment(slot, segment.url);
        setPlaying(true);
      }
    },
    [currentSegments, playSegment]
  );

  const handleRefreshManifest = useCallback(async () => {
    await fetchManifest();
  }, [fetchManifest]);

  // Handle difficulty marking
  const handleMarkDifficulty = useCallback(
    async (difficulty: PhraseDifficulty | null) => {
      if (!currentPhrase) return;

      try {
        await apiCall(`/api/phrases/${currentPhrase.phrase.id}`, {
          method: "PATCH",
          body: JSON.stringify({ difficulty }),
        });

        // Reload manifest to reflect the change
        await fetchManifest();

        const difficultyLabel = difficulty || "unset";
        if (toastRef.current) {
          toastRef.current.show(`Marked as ${difficultyLabel}`);
        }
      } catch (err) {
        if (toastRef.current) {
          toastRef.current.show(`Failed to update difficulty: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }
    },
    [currentPhrase, apiCall, fetchManifest]
  );

  // Touch gesture handlers
  const handleSwipeLeft = useCallback(() => {
    onAdvanceNext();
  }, [onAdvanceNext]);

  const handleSwipeRight = useCallback(() => {
    onAdvancePrev();
  }, [onAdvancePrev]);

  const handleDoubleTap = useCallback(() => {
    if (playing) {
      handlePause();
    } else {
      handlePlay();
    }
  }, [playing, handlePlay, handlePause]);

  const handleDoubleTapLeft = useCallback(() => {
    seekSmall("left");
  }, [seekSmall]);

  const handleDoubleTapRight = useCallback(() => {
    seekSmall("right");
  }, [seekSmall]);

  // Long press handled via PhraseViewer touch gestures

  // Keyboard shortcuts
  const shortcuts = {
    onPlayPause: playing ? handlePause : handlePlay,
    onStop: handleStop,
    onRestart: handleRestartPhrase,
    onSeekSmall: seekSmall,
    onSeekLarge: seekLarge,
    onPrevPhrase: onAdvancePrev,
    onNextPhrase: onAdvanceNext,
    onMarkDifficulty: handleMarkDifficulty,
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-muted-foreground">Authenticating...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-4">🔒</div>
          <p className="text-red-300 mb-4">Authentication required</p>
          <p className="text-muted-foreground text-sm">Please log in to access the player</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading playback manifest...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-4">⚠️</div>
          <p className="text-red-300 mb-4">{error}</p>
          <RefreshManifestButton loading={false} onRefresh={handleRefreshManifest} />
        </div>
      </div>
    );
  }

  if (!manifest || manifest.sequence.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-muted-foreground text-xl mb-4">📝</div>
          <p className="text-foreground mb-4">No phrases available for playback</p>
          <p className="text-muted-foreground text-sm">Generate audio first or check your notebook</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl lg:max-w-7xl mx-auto px-4 sm:px-6 pb-32 md:p-6 md:pb-6">
      <KeyboardShortcutsHandler {...shortcuts} />

      {/* Header with title, phrase counter and Back to Notebook link (no extra row) */}
      <div className="mb-6 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Audio Player</h1>
            <p
              className="text-sm min-[480px]:text-base sm:text-lg text-muted-foreground mt-1"
              aria-live="polite"
              aria-atomic="true"
            >
              Phrase <span className="font-medium text-foreground">{phraseIndex + 1}</span> of{" "}
              <span className="font-medium text-foreground">{manifest.sequence.length}</span>
              <DifficultyBadge
                difficulty={currentPhrase?.phrase.difficulty}
                className="ml-2"
                labelPrefix="Difficulty"
              />
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Mobile: difficulty menu tucked into header */}
            {currentPhrase && (
              <div className="md:hidden">
                <MobileActionMenu triggerLabel="Difficulty" triggerIcon triggerVariant="default" triggerSize="icon">
                  {({ close }) => (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            handleMarkDifficulty("easy");
                            close();
                          }}
                        >
                          Easy
                        </Button>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            handleMarkDifficulty("medium");
                            close();
                          }}
                        >
                          Medium
                        </Button>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            handleMarkDifficulty("hard");
                            close();
                          }}
                        >
                          Hard
                        </Button>
                        <Button
                          type="button"
                          variant={!currentPhrase.phrase.difficulty ? "default" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            handleMarkDifficulty(null);
                            close();
                          }}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  )}
                </MobileActionMenu>
              </div>
            )}
            <a
              href={`/notebooks/${notebookId}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to Notebook
            </a>
          </div>
        </div>
      </div>

      {/* Phrase viewer - vertical layout: EN on top, PL below */}
      <div className="mb-4">
        <PhraseViewer
          phrase={currentPhrase?.phrase}
          activeLang={currentSlot === "PL" ? "pl" : currentSlot ? "en" : null}
          highlight={highlight}
          onSeekToToken={handleSeekToToken}
          onSwipeLeft={handleSwipeLeft}
          onSwipeRight={handleSwipeRight}
          onDoubleTap={handleDoubleTap}
          onDoubleTapLeft={handleDoubleTapLeft}
          onDoubleTapRight={handleDoubleTapRight}
        />
      </div>

      {/* Segment sequence bar - right below phrases */}
      <div className="mb-2 md:mb-4">
        <SegmentSequenceBar
          sequenceForPhrase={currentSegments}
          activeSlot={currentSlot}
          onJumpToSlot={handleJumpToSlot}
          compact={isMobile}
        />
      </div>

      {/* Controls - sticky on desktop, fixed on mobile */}
      <PlayerControls
        playing={playing}
        speed={speed}
        highlight={highlight}
        hasPlayable={hasPlayableSegments}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onRestart={handleRestartPhrase}
        onSpeedChange={handleSpeedChange}
        onToggleHighlight={handleToggleHighlight}
        onPrevPhrase={onAdvancePrev}
        onNextPhrase={onAdvanceNext}
      />

      {/* Refresh manifest button */}
      {needsRefresh && (
        <div className="mt-4">
          <RefreshManifestButton loading={false} onRefresh={handleRefreshManifest} />
        </div>
      )}

      {/* Aria live region for playback state */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {playing ? "Playing" : "Paused"} - {currentSlot || "Stopped"}
      </div>
    </div>
  );
}
