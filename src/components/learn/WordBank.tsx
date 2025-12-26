import React, { useMemo, useEffect } from "react";
import { tokenizePhrase, generateWordPool } from "../../lib/word-bank.service";
import type { LearnPhraseDTO, LearnDirection } from "../../types";

interface WordBankProps {
  correctAnswer: string;
  selectedTokens: string[];
  onTokenSelect: (token: string) => void;
  onTokenRemove: (index: number) => void;
  allPhrases: LearnPhraseDTO[];
  currentPhraseId: string;
  direction: LearnDirection;
  isChecked: boolean;
  onAutoCheck?: () => void;
}

export default function WordBank({
  correctAnswer,
  selectedTokens,
  onTokenSelect,
  onTokenRemove,
  allPhrases,
  currentPhraseId,
  direction,
  isChecked,
  onAutoCheck,
}: WordBankProps) {
  // Generate word pool (memoized per phrase)
  const wordPool = useMemo(() => {
    return generateWordPool(correctAnswer, allPhrases, currentPhraseId, direction);
  }, [correctAnswer, allPhrases, currentPhraseId, direction]);

  // Count how many times each token appears in the pool
  const tokenCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const token of wordPool) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
    return counts;
  }, [wordPool]);

  // Count how many times each token is selected
  const selectedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const token of selectedTokens) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
    return counts;
  }, [selectedTokens]);

  // Calculate available tokens (pool minus selected)
  const availableTokens = useMemo(() => {
    return wordPool.filter((token) => {
      const poolCount = tokenCounts.get(token) || 0;
      const selectedCount = selectedCounts.get(token) || 0;
      return selectedCount < poolCount;
    });
  }, [wordPool, tokenCounts, selectedCounts]);

  // Get correct token count for auto-check
  const correctTokenCount = useMemo(() => {
    return tokenizePhrase(correctAnswer).length;
  }, [correctAnswer]);

  // Auto-check when answer is complete
  useEffect(() => {
    if (!isChecked && selectedTokens.length === correctTokenCount && onAutoCheck) {
      // Small delay to ensure UI updates first
      const timer = setTimeout(() => {
        onAutoCheck();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedTokens.length, correctTokenCount, isChecked, onAutoCheck]);

  const handleTokenClick = (token: string) => {
    if (isChecked) return; // Disabled after check

    const poolCount = tokenCounts.get(token) || 0;
    const selectedCount = selectedCounts.get(token) || 0;

    if (selectedCount < poolCount) {
      onTokenSelect(token);
    }
  };

  const handleSelectedTokenClick = (index: number) => {
    if (isChecked) return; // Disabled after check
    onTokenRemove(index);
  };

  return (
    <div className="space-y-4">
      {/* Answer area (selected tokens) */}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1.5 block">Your answer</div>
        <div
          className={`min-h-[72px] rounded-md border border-border bg-card px-3 py-2 flex flex-wrap items-center gap-1.5 ${
            isChecked ? "opacity-75" : ""
          }`}
        >
          {selectedTokens.length === 0 ? (
            <span className="text-muted-foreground text-sm">Click tokens below to build your answer</span>
          ) : (
            selectedTokens.map((token, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleSelectedTokenClick(index)}
                disabled={isChecked}
                className={`rounded-md px-2 py-1 text-sm leading-5 bg-muted text-foreground transition-colors ${
                  isChecked ? "cursor-default" : "hover:bg-muted/80 active:bg-muted/60 cursor-pointer"
                }`}
              >
                {token}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Word pool */}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1.5 block">Word pool</div>
        <div className={`flex flex-wrap gap-1.5 ${isChecked ? "opacity-50 pointer-events-none" : ""}`}>
          {availableTokens.map((token, index) => {
            const poolCount = tokenCounts.get(token) || 0;
            const selectedCount = selectedCounts.get(token) || 0;
            const remaining = poolCount - selectedCount;

            return (
              <button
                key={`${token}-${index}`}
                type="button"
                onClick={() => handleTokenClick(token)}
                disabled={isChecked || remaining === 0}
                className={`rounded-md px-2 py-1 text-sm leading-5 bg-muted text-foreground transition-colors ${
                  isChecked || remaining === 0
                    ? "cursor-default opacity-50"
                    : "hover:bg-muted/80 active:bg-muted/60 cursor-pointer"
                }`}
              >
                {token}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
