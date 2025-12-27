import React from "react";
import type { PhraseDifficulty } from "../types";
import { cn } from "../lib/utils";

type DifficultyDisplay = PhraseDifficulty | "unset";

function getDifficultyDisplay(difficulty: PhraseDifficulty | null | undefined): DifficultyDisplay {
  return difficulty || "unset";
}

const colors: Record<DifficultyDisplay, string> = {
  easy: "bg-green-500/20 text-green-300 border-green-500/40",
  medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  hard: "bg-red-500/20 text-red-300 border-red-500/40",
  unset: "bg-muted text-muted-foreground border-transparent",
};

export default function DifficultyBadge({
  difficulty,
  className,
  labelPrefix,
}: {
  difficulty: PhraseDifficulty | null | undefined;
  className?: string;
  labelPrefix?: string;
}) {
  const display = getDifficultyDisplay(difficulty);
  const text = display === "unset" ? "unset" : display;
  const title = `${labelPrefix ? `${labelPrefix}: ` : ""}${text}`;

  return (
    <span className={cn("text-xs font-medium px-2 py-0.5 rounded border", colors[display], className)} title={title}>
      {display === "unset" ? "—" : display}
    </span>
  );
}
