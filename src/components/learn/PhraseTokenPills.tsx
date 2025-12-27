import React, { useMemo } from "react";
import type { PhraseToken } from "../../types";

interface FormattingRange {
  start: number;
  end: number;
  type: "bold" | "italic";
  markerLength: number;
}

function findFormattingRanges(text: string): FormattingRange[] {
  const ranges: FormattingRange[] = [];

  // Bold (**text**)
  const boldRegex = /\*\*([^*]+?)\*\*/g;
  let match: RegExpExecArray | null;
  while ((match = boldRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length, type: "bold", markerLength: 2 });
  }

  // Italic: prioritize __text__
  const doubleItalicRegex = /(?:^|[^\w_])__([^_]+?)__(?=[^\w_]|$)/g;
  while ((match = doubleItalicRegex.exec(text)) !== null) {
    const actualStart = match.index + (match[0][0] === "_" ? 0 : 1);
    const actualEnd = actualStart + match[0].length;
    ranges.push({ start: actualStart, end: actualEnd, type: "italic", markerLength: 2 });
  }

  // Italic: _text_ (avoid overlaps with __text__)
  const singleItalicRegex = /(?:^|[^\w_])_([^_]+?)_(?=[^\w_]|$)/g;
  while ((match = singleItalicRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const beforeChar = matchIndex > 0 ? text[matchIndex - 1] : "";
    const afterIndex = matchIndex + match[0].length;
    const afterChar = afterIndex < text.length ? text[afterIndex] : "";
    const isPartOfDouble = beforeChar === "_" || afterChar === "_";
    if (isPartOfDouble) continue;

    const actualStart = matchIndex + 1;
    const actualEnd = actualStart + match[0].length;

    const overlaps = ranges.some((r) => r.type === "italic" && actualStart < r.end && actualEnd > r.start);
    if (!overlaps) {
      ranges.push({ start: actualStart, end: actualEnd, type: "italic", markerLength: 1 });
    }
  }

  return ranges.sort((a, b) => a.start - b.start);
}

function cleanTokenText(raw: string, isItalic: boolean): string {
  let tokenText = raw;
  tokenText = tokenText.replace(/\*\*/g, "");
  tokenText = tokenText.replace(/__/g, "");
  if (isItalic) {
    tokenText = tokenText.replace(/_/g, "");
  }
  return tokenText;
}

export default function PhraseTokenPills({
  tokens,
  originalText,
  highlight,
  size = "lg",
}: {
  tokens: PhraseToken[] | null | undefined;
  originalText: string;
  highlight: boolean;
  size?: "sm" | "lg";
}) {
  const formattingRanges = useMemo(() => findFormattingRanges(originalText || ""), [originalText]);

  if (!tokens || tokens.length === 0) {
    return <span className="text-muted-foreground italic">No tokens available</span>;
  }

  const base =
    size === "lg"
      ? "rounded-md px-2 py-1 text-base min-[480px]:text-lg sm:text-xl lg:text-2xl leading-5 min-[480px]:leading-6 sm:leading-7 lg:leading-8"
      : "rounded-md px-2 py-1 text-sm leading-5";

  const tokenClass = highlight
    ? "bg-yellow-400/25 ring-1 ring-yellow-400/60 text-foreground"
    : "bg-muted text-foreground";

  return (
    <div className="flex flex-wrap items-center gap-1 md:gap-1.5">
      {tokens.map((token, index) => {
        const tokenStart = token.start;
        const tokenEnd = token.end;

        let isBold = false;
        let isItalic = false;

        for (const range of formattingRanges) {
          if (tokenStart < range.end && tokenEnd > range.start) {
            if (range.type === "bold") isBold = true;
            if (range.type === "italic") isItalic = true;
          }
        }

        const tokenText = cleanTokenText(token.text, isItalic);

        const content =
          isBold && isItalic ? (
            <strong>
              <em>{tokenText}</em>
            </strong>
          ) : isBold ? (
            <strong>{tokenText}</strong>
          ) : isItalic ? (
            <em>{tokenText}</em>
          ) : (
            tokenText
          );

        return (
          <span key={index} className={`${base} ${tokenClass}`}>
            {content}
          </span>
        );
      })}
    </div>
  );
}
