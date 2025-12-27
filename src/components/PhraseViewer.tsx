import React, { useRef, useCallback, useMemo } from "react";
import type { PhraseVM } from "../types";
import { useTouchGestures } from "../lib/hooks/useTouchGestures";

interface PhraseViewerProps {
  phrase?: PhraseVM;
  activeLang: "en" | "pl" | null;
  highlight: boolean;
  onSeekToToken: (tokenIndex: number, language: "en" | "pl") => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onDoubleTap?: () => void;
  onDoubleTapLeft?: () => void;
  onDoubleTapRight?: () => void;
}

export default function PhraseViewer({
  phrase,
  activeLang,
  highlight,
  onSeekToToken,
  onSwipeLeft,
  onSwipeRight,
  onDoubleTap,
  onDoubleTapLeft,
  onDoubleTapRight,
}: PhraseViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { getTouchHandlers } = useTouchGestures({
    onSwipeLeft,
    onSwipeRight,
    onDoubleTap,
    onDoubleTapLeft,
    onDoubleTapRight,
  });

  const touchHandlers = getTouchHandlers();

  // Merge refs
  const mergedRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      if (touchHandlers.ref) {
        touchHandlers.ref.current = el;
      }
    },
    [touchHandlers.ref]
  );

  // Helper function to find formatting ranges in text
  const findFormattingRanges = useMemo(() => {
    return (text: string): { start: number; end: number; type: "bold" | "italic"; markerLength: number }[] => {
      const ranges: { start: number; end: number; type: "bold" | "italic"; markerLength: number }[] = [];

      // Find bold ranges (**text**)
      const boldRegex = /\*\*([^*]+?)\*\*/g;
      let match: RegExpExecArray | null;
      while ((match = boldRegex.exec(text)) !== null) {
        ranges.push({
          start: match.index,
          end: match.index + match[0].length,
          type: "bold",
          markerLength: 2, // ** at start and end
        });
      }

      // Find italic ranges - prioritize double underscores (__text__)
      // Match __text__ where underscores are at word boundaries (not part of words)
      // Pattern: (start of string or non-word char) then __text__ then (end of string or non-word char)
      const doubleItalicRegex = /(?:^|[^\w_])__([^_]+?)__(?=[^\w_]|$)/g;
      while ((match = doubleItalicRegex.exec(text)) !== null) {
        // Adjust for the leading non-word character if present
        const actualStart = match.index + (match[0][0] === "_" ? 0 : match[0][0].match(/[\w]/) ? 0 : 1);
        const actualEnd = actualStart + match[0].length - (match[0][match[0].length - 1].match(/[\w_]/) ? 0 : 1);
        ranges.push({
          start: actualStart,
          end: actualEnd,
          type: "italic",
          markerLength: 2, // __ at start and end
        });
      }

      // Find single underscore ranges (_text_) - treat as italic
      // Only match if underscore is at word boundary (not part of a word)
      // Pattern: (start of string or non-word char) then _text_ then (end of string or non-word char)
      const singleItalicRegex = /(?:^|[^\w_])_([^_]+?)_(?=[^\w_]|$)/g;
      while ((match = singleItalicRegex.exec(text)) !== null) {
        // Check if this single underscore is part of a double underscore range
        const matchIndex = match.index;
        const beforeChar = matchIndex > 0 ? text[matchIndex - 1] : "";
        const afterIndex = matchIndex + match[0].length;
        const afterChar = afterIndex < text.length ? text[afterIndex] : "";
        const isPartOfDouble = beforeChar === "_" || afterChar === "_";

        if (!isPartOfDouble && match) {
          // Adjust for the leading non-word character if present
          const actualStart = matchIndex + (match[0][0] === "_" ? 0 : match[0][0].match(/[\w]/) ? 0 : 1);
          const actualEnd = actualStart + match[0].length - (match[0][match[0].length - 1].match(/[\w_]/) ? 0 : 1);
          const actualMatchIndex = actualStart;
          const actualMatchLength = actualEnd - actualStart;

          // Check if this range overlaps with any existing double underscore range
          const overlaps = ranges.some(
            (r) =>
              r.type === "italic" &&
              ((actualMatchIndex >= r.start && actualMatchIndex < r.end) ||
                (actualMatchIndex + actualMatchLength > r.start && actualMatchIndex + actualMatchLength <= r.end) ||
                (actualMatchIndex <= r.start && actualMatchIndex + actualMatchLength >= r.end))
          );
          if (!overlaps) {
            ranges.push({
              start: actualMatchIndex,
              end: actualMatchIndex + actualMatchLength,
              type: "italic",
              markerLength: 1, // _ at start and end
            });
          }
        }
      }

      return ranges.sort((a, b) => a.start - b.start);
    };
  }, []);

  if (!phrase) {
    return (
      <div className="h-[clamp(240px,32vh,360px)] rounded-lg border bg-card px-4 py-3 flex items-center justify-center">
        <p className="text-muted-foreground">No phrase selected</p>
      </div>
    );
  }

  const renderTokens = (tokens: PhraseVM["tokens"]["en"] | PhraseVM["tokens"]["pl"], language: "en" | "pl") => {
    if (!tokens || tokens.length === 0) {
      return <span className="text-muted-foreground italic">No tokens available</span>;
    }

    const isActive = activeLang === language;
    const isHighlighted = highlight && isActive;

    // Get the original text for this language
    const originalText = language === "en" ? phrase.en_text : phrase.pl_text;
    const formattingRanges = findFormattingRanges(originalText);

    return (
      <div className="flex flex-wrap items-center gap-1 md:gap-1.5">
        {tokens.map((token, index) => {
          const isTokenActive = isHighlighted && isActive;

          // Check if token overlaps with any formatting range
          // Token positions are character indices in the original text
          const tokenStart = token.charStart;
          const tokenEnd = token.charEnd;

          // Find which formatting applies to this token
          // We need to account for the fact that formatting markers (**, __, _) are in the text
          // but tokens might not include them. So we check if the token's text content
          // falls within a formatting range.
          let isBold = false;
          let isItalic = false;

          for (const range of formattingRanges) {
            // Check if token overlaps with formatting range
            // The range includes the markers, so we check if token overlaps with the entire range
            // (including markers, since tokens may include them)
            if (range.type === "bold") {
              // Bold range: **text**, range includes the ** markers
              if (tokenStart < range.end && tokenEnd > range.start) {
                isBold = true;
              }
            } else if (range.type === "italic") {
              // Italic range: __text__ or _text_, range includes the markers
              if (tokenStart < range.end && tokenEnd > range.start) {
                isItalic = true;
              }
            }
          }

          // Clean token text (remove formatting markers if present)
          let tokenText = token.text;
          // Remove bold markers (**)
          tokenText = tokenText.replace(/\*\*/g, "");
          // Remove double italic markers (__)
          tokenText = tokenText.replace(/__/g, "");
          // Remove single italic markers (_) if this token is part of italic formatting
          // If the token is in an italic range, any _ in it are formatting markers, not part of words
          if (isItalic) {
            // Remove all _ from the token since they are formatting markers
            tokenText = tokenText.replace(/_/g, "");
          }

          return (
            <button
              key={index}
              onClick={() => onSeekToToken(index, language)}
              className={`
                rounded-md px-2 py-1 text-lg min-[480px]:text-2xl sm:text-2xl lg:text-2xl leading-6 min-[480px]:leading-8 sm:leading-8 lg:leading-8
                transition-all duration-200
                ${
                  isTokenActive
                    ? "bg-yellow-400/25 ring-1 ring-yellow-400/60 text-foreground"
                    : isActive
                      ? "bg-muted text-foreground hover:bg-muted/80 cursor-pointer"
                      : "text-muted-foreground cursor-default"
                }
              `}
              disabled={!isActive}
              aria-label={`Seek to word: ${tokenText}`}
            >
              {isBold && isItalic ? (
                <strong>
                  <em>{tokenText}</em>
                </strong>
              ) : isBold ? (
                <strong>{tokenText}</strong>
              ) : isItalic ? (
                <em>{tokenText}</em>
              ) : (
                tokenText
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const renderLanguageBadge = (language: "en" | "pl", label: string) => {
    const isActive = activeLang === language;
    return (
      <div className="hidden sm:flex items-center gap-2 mb-1">
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded ${
            isActive
              ? language === "en"
                ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                : "bg-green-500/20 text-green-300 border border-green-500/40"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {label}
        </span>
        {isActive && <span className="text-xs text-muted-foreground animate-pulse">●</span>}
      </div>
    );
  };

  return (
    <div
      ref={mergedRef}
      onTouchStart={touchHandlers.onTouchStart}
      onTouchMove={touchHandlers.onTouchMove}
      onTouchEnd={touchHandlers.onTouchEnd}
      className="h-auto md:h-[clamp(240px,32vh,360px)] overflow-visible md:overflow-y-auto rounded-lg border bg-card px-4 py-3"
    >
      {/* English text - on top */}
      <div className="min-h-[64px] md:min-h-[72px] mb-2 md:mb-3">
        {renderLanguageBadge("en", "EN")}
        {renderTokens(phrase.tokens.en, "en")}
      </div>

      {/* Polish text - below */}
      <div className="min-h-[64px] md:min-h-[72px]">
        {renderLanguageBadge("pl", "PL")}
        {renderTokens(phrase.tokens.pl, "pl")}
      </div>
    </div>
  );
}
