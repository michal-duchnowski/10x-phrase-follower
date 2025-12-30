import { useEffect } from "react";

interface UseMediaSessionProps {
  /** If false, the hook will not register handlers or metadata. */
  enabled: boolean;
  /** Human-readable title shown on lock screen / system players. */
  title: string;
  /** Optional subtitle/artist shown on lock screen / system players. */
  artist?: string;
  /** Optional album shown on lock screen / system players. */
  album?: string;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onPrevPhrase: () => void;
  onNextPhrase: () => void;
}

/**
 * Integrates with the Media Session API so headset/lock-screen controls can
 * map to our phrase navigation (esp. important on iOS where Safari often shows
 * 10s seek buttons unless action handlers are registered).
 */
export function useMediaSession({
  enabled,
  title,
  artist,
  album,
  playing,
  onPlay,
  onPause,
  onStop,
  onPrevPhrase,
  onNextPhrase,
}: UseMediaSessionProps) {
  // Register metadata and action handlers
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined") return;
    if (!("mediaSession" in navigator)) return;

    const ms = navigator.mediaSession;

    try {
      ms.metadata = new MediaMetadata({
        title,
        artist,
        album,
      });
    } catch (error) {
      // Some environments may throw if MediaMetadata is not supported.
      // eslint-disable-next-line no-console
      console.warn("[useMediaSession] Failed to set metadata:", error);
    }

    const safeSet = (action: MediaSessionAction, handler: (() => void) | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // iOS/Safari can throw for unsupported actions; ignore.
      }
    };

    // Core controls
    safeSet("play", onPlay);
    safeSet("pause", onPause);
    safeSet("stop", onStop);

    // Phrase navigation
    safeSet("previoustrack", onPrevPhrase);
    safeSet("nexttrack", onNextPhrase);

    // Fallback: on iOS lock screen, these are often the only visible buttons.
    // Repurpose them to phrase navigation (user intention: whole phrase).
    safeSet("seekbackward", onPrevPhrase);
    safeSet("seekforward", onNextPhrase);

    return () => {
      // Reset handlers to avoid leaking references when navigating between pages.
      safeSet("play", null);
      safeSet("pause", null);
      safeSet("stop", null);
      safeSet("previoustrack", null);
      safeSet("nexttrack", null);
      safeSet("seekbackward", null);
      safeSet("seekforward", null);
    };
  }, [enabled, title, artist, album, onPlay, onPause, onStop, onPrevPhrase, onNextPhrase]);

  // Keep playback state in sync
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined") return;
    if (!("mediaSession" in navigator)) return;

    try {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    } catch {
      // ignore
    }
  }, [enabled, playing]);
}
