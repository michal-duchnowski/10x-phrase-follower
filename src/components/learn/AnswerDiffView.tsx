import React, { useMemo } from "react";
import type { CheckAnswerResultDTO } from "../../types";

function stripMarkdownMarkersForDisplay(text: string): string {
  if (!text || typeof text !== "string") return "";

  return (
    text
      // Remove zero-width and control characters (same as normalization)
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, " ")
      // Remove markdown-like emphasis markers so "**Affair**" displays as "Affair"
      .replace(/[*_]+/g, " ")
      // Normalize whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

// Character-level diff for original strings (not normalized).
// Uses normalized comparison result to highlight differences in original text.
type DiffSegmentType = "equal" | "different";

interface DiffSegment {
  type: DiffSegmentType;
  text: string;
}

// Simple word-level diff for better readability
function diffOriginalStrings(
  userAnswer: string,
  correctAnswer: string,
  normalizedUser: string,
  normalizedCorrect: string
): { userSegments: DiffSegment[]; correctSegments: DiffSegment[] } {
  if (normalizedUser === normalizedCorrect) {
    return {
      userSegments: [{ type: "equal", text: userAnswer || "" }],
      correctSegments: [{ type: "equal", text: correctAnswer || "" }],
    };
  }

  const userWords = (userAnswer || "").split(/(\s+)/);
  const correctWords = (correctAnswer || "").split(/(\s+)/);
  const normalizedUserWords = normalizedUser.split(/\s+/).filter((w) => w.length > 0);
  const normalizedCorrectWords = normalizedCorrect.split(/\s+/).filter((w) => w.length > 0);

  const userSegments: DiffSegment[] = [];
  const correctSegments: DiffSegment[] = [];

  let userIdx = 0;
  let correctIdx = 0;
  let normalizedUserIdx = 0;
  let normalizedCorrectIdx = 0;

  while (userIdx < userWords.length || correctIdx < correctWords.length) {
    if (userIdx < userWords.length && /^\s+$/.test(userWords[userIdx])) {
      userSegments.push({ type: "equal", text: userWords[userIdx] });
      userIdx += 1;
      continue;
    }
    if (correctIdx < correctWords.length && /^\s+$/.test(correctWords[correctIdx])) {
      correctSegments.push({ type: "equal", text: correctWords[correctIdx] });
      correctIdx += 1;
      continue;
    }

    const userWord = normalizedUserIdx < normalizedUserWords.length ? normalizedUserWords[normalizedUserIdx] : null;
    const correctWord =
      normalizedCorrectIdx < normalizedCorrectWords.length ? normalizedCorrectWords[normalizedCorrectIdx] : null;

    if (userWord === correctWord && userWord !== null) {
      if (userIdx < userWords.length) {
        userSegments.push({ type: "equal", text: userWords[userIdx] });
        userIdx += 1;
      }
      if (correctIdx < correctWords.length) {
        correctSegments.push({ type: "equal", text: correctWords[correctIdx] });
        correctIdx += 1;
      }
      normalizedUserIdx += 1;
      normalizedCorrectIdx += 1;
    } else {
      if (userIdx < userWords.length && !/^\s+$/.test(userWords[userIdx])) {
        userSegments.push({ type: "different", text: userWords[userIdx] });
        userIdx += 1;
        if (userWord !== null) normalizedUserIdx += 1;
      }
      if (correctIdx < correctWords.length && !/^\s+$/.test(correctWords[correctIdx])) {
        correctSegments.push({ type: "different", text: correctWords[correctIdx] });
        correctIdx += 1;
        if (correctWord !== null) normalizedCorrectIdx += 1;
      }
    }
  }

  return { userSegments, correctSegments };
}

export default function AnswerDiffView({
  userAnswer,
  correctAnswer,
  result,
}: {
  userAnswer: string;
  correctAnswer: string;
  result: CheckAnswerResultDTO | null;
}) {
  const displayUserAnswer = useMemo(() => stripMarkdownMarkersForDisplay(userAnswer), [userAnswer]);
  const displayCorrectAnswer = useMemo(() => stripMarkdownMarkersForDisplay(correctAnswer), [correctAnswer]);

  const { userSegments, correctSegments } = useMemo(() => {
    if (!result) {
      return { userSegments: [] as DiffSegment[], correctSegments: [] as DiffSegment[] };
    }
    return diffOriginalStrings(
      displayUserAnswer,
      displayCorrectAnswer,
      result.normalized_user,
      result.normalized_correct
    );
  }, [displayUserAnswer, displayCorrectAnswer, result]);

  if (!result) {
    return null;
  }

  const isOverallCorrect = result.is_correct;
  const pillBase = "rounded-md px-2 py-1 text-sm md:text-base leading-5 md:leading-6 transition-colors select-text";

  const renderPills = (segments: DiffSegment[], isUser: boolean) => {
    const pills = segments
      .map((seg, index) => {
        const text = seg.text ?? "";
        if (!text.trim()) return null;

        if (seg.type === "equal") {
          return (
            <span
              key={index}
              className={`${pillBase} ${
                isOverallCorrect
                  ? "bg-emerald-500/15 ring-1 ring-emerald-500/40 text-foreground"
                  : "bg-muted/60 border border-border/60 text-foreground"
              }`}
            >
              {text}
            </span>
          );
        }

        if (isUser) {
          return (
            <span key={index} className={`${pillBase} bg-destructive/15 ring-1 ring-destructive/40 text-foreground`}>
              {text}
            </span>
          );
        }

        return (
          <span key={index} className={`${pillBase} bg-emerald-500/15 ring-1 ring-emerald-500/40 text-foreground`}>
            {text}
          </span>
        );
      })
      .filter((x): x is React.ReactElement => x !== null);

    if (pills.length === 0) {
      return <span className="text-muted-foreground italic">empty</span>;
    }

    return <div className="flex flex-wrap items-center gap-1.5">{pills}</div>;
  };

  return (
    <div className="mt-4 space-y-3">
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Your answer</div>
        <div className="rounded-lg border bg-card px-4 py-3">{renderPills(userSegments, true)}</div>
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Correct answer</div>
        <div className="rounded-lg border bg-card px-4 py-3">{renderPills(correctSegments, false)}</div>
      </div>
    </div>
  );
}
