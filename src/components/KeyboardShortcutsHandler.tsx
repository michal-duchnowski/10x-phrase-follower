import { useEffect } from "react";

interface KeyboardShortcutsHandlerProps {
  onPlayPause: () => void;
  onStop: () => void;
  onRestart: () => void;
  onSeekSmall?: (direction: "left" | "right") => void;
  onSeekLarge?: (direction: "left" | "right") => void;
  onPrevPhrase: () => void;
  onNextPhrase: () => void;
  onMarkDifficulty?: (difficulty: "easy" | "medium" | "hard" | null) => void;
}

export default function KeyboardShortcutsHandler({
  onPlayPause,
  onStop,
  onRestart,
  onSeekSmall,
  onSeekLarge,
  onPrevPhrase,
  onNextPhrase,
  onMarkDifficulty,
}: KeyboardShortcutsHandlerProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.contentEditable === "true") {
        return;
      }

      // Prevent default for our shortcuts
      const preventDefault = () => event.preventDefault();

      switch (event.key.toLowerCase()) {
        case " ":
        case "k":
          preventDefault();
          onPlayPause();
          break;

        case "s":
          preventDefault();
          onStop();
          break;

        case "r":
          preventDefault();
          onRestart();
          break;

        case "arrowleft":
          if (onSeekSmall || onSeekLarge) {
            preventDefault();
            if (event.shiftKey && onSeekLarge) {
              onSeekLarge("left");
            } else if (onSeekSmall) {
              onSeekSmall("left");
            }
          }
          break;

        case "arrowright":
          if (onSeekSmall || onSeekLarge) {
            preventDefault();
            if (event.shiftKey && onSeekLarge) {
              onSeekLarge("right");
            } else if (onSeekSmall) {
              onSeekSmall("right");
            }
          }
          break;

        case "p":
          preventDefault();
          onPrevPhrase();
          break;

        case "n":
          preventDefault();
          onNextPhrase();
          break;

        case "1":
          if (onMarkDifficulty) {
            preventDefault();
            onMarkDifficulty("easy");
          }
          break;

        case "2":
          if (onMarkDifficulty) {
            preventDefault();
            onMarkDifficulty("medium");
          }
          break;

        case "3":
          if (onMarkDifficulty) {
            preventDefault();
            onMarkDifficulty("hard");
          }
          break;

        case "0":
          if (onMarkDifficulty) {
            preventDefault();
            onMarkDifficulty(null);
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onPlayPause, onStop, onRestart, onSeekSmall, onSeekLarge, onPrevPhrase, onNextPhrase, onMarkDifficulty]);

  return null; // This component doesn't render anything
}
