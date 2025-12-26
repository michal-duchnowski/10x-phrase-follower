import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { ToastProvider, useToast } from "./ui/toast";
import { useApi } from "../lib/hooks/useApi";
import type { CheckAnswerResultDTO, LearnDirection, LearnManifestDTO, LearnPhraseDTO } from "../types";
import { parseMarkdownToHtml } from "../lib/utils";

interface LearnViewProps {
  notebookId: string;
}

type SessionPhase = "idle" | "in_progress" | "round_summary";

interface CardResultState {
  isChecked: boolean;
  isCorrect: boolean | null;
  backendResult: CheckAnswerResultDTO | null;
  userAnswer: string;
}

interface LearnSessionState {
  phase: SessionPhase;
  direction: LearnDirection;
  shuffle: boolean;
  currentRound: LearnPhraseDTO[];
  currentIndex: number;
  roundNumber: number;
  correctCount: number;
  incorrectCount: number;
  // map phrase_id -> last result in this round
  answers: Record<string, CardResultState>;
  // phrases that were answered incorrectly in this round
  incorrectPhrases: LearnPhraseDTO[];
}

function createInitialSessionState(): LearnSessionState {
  return {
    phase: "idle",
    direction: "en_to_pl",
    shuffle: true,
    currentRound: [],
    currentIndex: 0,
    roundNumber: 1,
    correctCount: 0,
    incorrectCount: 0,
    answers: {},
    incorrectPhrases: [],
  };
}

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getPromptText(phrase: LearnPhraseDTO, direction: LearnDirection): string {
  return direction === "en_to_pl" ? phrase.en_text : phrase.pl_text;
}

function getAnswerLanguageLabel(direction: LearnDirection): string {
  return direction === "en_to_pl" ? "Polish" : "English";
}

function getPromptLanguageLabel(direction: LearnDirection): string {
  return direction === "en_to_pl" ? "English" : "Polish";
}

function getHasAudio(phrase: LearnPhraseDTO, direction: LearnDirection): boolean {
  return direction === "en_to_pl" ? phrase.audio.has_en_audio : phrase.audio.has_pl_audio;
}

// Very simple character-level diff for normalized strings.
// Returns array of segments with type for styling.
type DiffSegmentType = "equal" | "insert" | "delete";

interface DiffSegment {
  type: DiffSegmentType;
  text: string;
}

function diffStrings(a: string, b: string): { aSegments: DiffSegment[]; bSegments: DiffSegment[] } {
  if (!a && !b) {
    return { aSegments: [], bSegments: [] };
  }

  // Simple algorithm: walk through both strings; mark mismatches
  const aSegments: DiffSegment[] = [];
  const bSegments: DiffSegment[] = [];

  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      const startI = i;
      const startJ = j;
      while (i < a.length && j < b.length && a[i] === b[j]) {
        i += 1;
        j += 1;
      }
      aSegments.push({ type: "equal", text: a.slice(startI, i) });
      bSegments.push({ type: "equal", text: b.slice(startJ, j) });
      continue;
    }

    if (i < a.length) {
      aSegments.push({ type: "delete", text: a[i] });
      i += 1;
    }

    if (j < b.length) {
      bSegments.push({ type: "insert", text: b[j] });
      j += 1;
    }
  }

  return { aSegments, bSegments };
}

function AnswerDiffView({ result }: { result: CheckAnswerResultDTO | null }) {
  const { aSegments, bSegments } = useMemo(() => {
    if (!result) {
      return { aSegments: [] as DiffSegment[], bSegments: [] as DiffSegment[] };
    }
    return diffStrings(result.normalized_user, result.normalized_correct);
  }, [result]);

  if (!result) {
    return null;
  }

  const renderSegments = (segments: DiffSegment[], isUser: boolean) =>
    segments.map((seg, index) => {
      if (seg.type === "equal") {
        return (
          <span key={index} className="text-foreground">
            {seg.text}
          </span>
        );
      }
      if (isUser) {
        // User answer: highlight differences in red
        return (
          <span key={index} className="bg-destructive/20 text-destructive px-0.5 rounded">
            {seg.text}
          </span>
        );
      }
      // Correct answer: highlight differences in green
      return (
        <span key={index} className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-0.5 rounded">
          {seg.text}
        </span>
      );
    });

  return (
    <div className="mt-4 space-y-3 text-sm">
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Your (normalized) answer</div>
        <div className="px-3 py-2 rounded-md bg-muted/60 border border-border/60 font-mono text-[13px] break-words">
          {aSegments.length === 0 ? (
            <span className="text-muted-foreground italic">empty</span>
          ) : (
            renderSegments(aSegments, true)
          )}
        </div>
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Correct (normalized) answer</div>
        <div className="px-3 py-2 rounded-md bg-muted/60 border border-border/60 font-mono text-[13px] break-words">
          {bSegments.length === 0 ? (
            <span className="text-muted-foreground italic">empty</span>
          ) : (
            renderSegments(bSegments, false)
          )}
        </div>
      </div>
    </div>
  );
}

function LearnViewContent({ notebookId }: LearnViewProps) {
  const { apiCall, isAuthenticated } = useApi();
  const { addToast } = useToast();

  const [manifest, setManifest] = useState<LearnManifestDTO | null>(null);
  const [manifestLoading, setManifestLoading] = useState<boolean>(true);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const [session, setSession] = useState<LearnSessionState>(() => createInitialSessionState());

  const currentPhrase: LearnPhraseDTO | null =
    session.phase === "in_progress" && session.currentRound[session.currentIndex]
      ? session.currentRound[session.currentIndex]
      : null;

  const currentCardResult: CardResultState | null =
    currentPhrase && session.answers[currentPhrase.id] ? session.answers[currentPhrase.id] : null;

  const remainingInRound = session.phase === "in_progress" ? session.currentRound.length - session.currentIndex - 1 : 0;

  // Load learn manifest when authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const loadManifest = async () => {
      setManifestLoading(true);
      setManifestError(null);

      try {
        const data = await apiCall<LearnManifestDTO>(`/api/notebooks/${notebookId}/learn-manifest`, {
          method: "GET",
        });
        setManifest(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load learn manifest.";
        setManifestError(message);
        addToast({
          type: "error",
          title: "Cannot start learn mode",
          description: message,
        });
      } finally {
        setManifestLoading(false);
      }
    };

    loadManifest();
  }, [apiCall, notebookId, isAuthenticated, addToast]);

  const handleChangeDirection = (direction: LearnDirection) => {
    setSession((prev) => ({
      ...prev,
      direction,
    }));
  };

  const handleToggleShuffle = () => {
    setSession((prev) => ({
      ...prev,
      shuffle: !prev.shuffle,
    }));
  };

  const startRound = (phrases: LearnPhraseDTO[]) => {
    if (!phrases.length) {
      addToast({
        type: "info",
        title: "No phrases to learn",
        description: "This notebook does not contain any phrases yet.",
      });
      return;
    }

    const ordered = session.shuffle ? shuffleArray(phrases) : [...phrases];

    setSession((prev) => ({
      ...prev,
      phase: "in_progress",
      currentRound: ordered,
      currentIndex: 0,
      correctCount: 0,
      incorrectCount: 0,
      answers: {},
      incorrectPhrases: [],
    }));
  };

  const handleStart = () => {
    if (!manifest || manifest.phrase_count === 0) {
      addToast({
        type: "info",
        title: "No phrases in notebook",
        description: "You need to import phrases before using learn mode.",
      });
      return;
    }

    startRound(manifest.phrases);
  };

  const handleUserAnswerChange = (value: string) => {
    if (!currentPhrase) return;

    setSession((prev) => {
      const prevState = prev.answers[currentPhrase.id];
      return {
        ...prev,
        answers: {
          ...prev.answers,
          [currentPhrase.id]: {
            isChecked: prevState ? prevState.isChecked : false,
            isCorrect: prevState ? prevState.isCorrect : null,
            backendResult: prevState ? prevState.backendResult : null,
            userAnswer: value,
          },
        },
      };
    });
  };

  const handleCheckAnswer = async () => {
    if (!currentPhrase) {
      return;
    }

    const draft = session.answers[currentPhrase.id];
    const userAnswer = draft?.userAnswer ?? "";

    try {
      const result = await apiCall<CheckAnswerResultDTO>(`/api/notebooks/${notebookId}/learn/check-answer`, {
        method: "POST",
        body: JSON.stringify({
          phrase_id: currentPhrase.id,
          user_answer: userAnswer,
          direction: session.direction,
        }),
      });

      setSession((prev) => {
        const wasAnsweredBefore = prev.answers[currentPhrase.id]?.isChecked ?? false;
        const previousCorrect = prev.answers[currentPhrase.id]?.isCorrect;

        let correctCount = prev.correctCount;
        let incorrectCount = prev.incorrectCount;

        // Adjust stats only if this is the first check for this card in this round
        if (!wasAnsweredBefore) {
          if (result.is_correct) {
            correctCount += 1;
          } else {
            incorrectCount += 1;
          }
        } else if (previousCorrect !== null && previousCorrect !== result.is_correct) {
          // Rare case: user changed answer and rechecked before moving on
          if (previousCorrect) {
            correctCount -= 1;
            incorrectCount += 1;
          } else {
            incorrectCount -= 1;
            correctCount += 1;
          }
        }

        const newAnswers: Record<string, CardResultState> = {
          ...prev.answers,
          [currentPhrase.id]: {
            isChecked: true,
            isCorrect: result.is_correct,
            backendResult: result,
            userAnswer,
          },
        };

        const incorrectPhrasesMap: Record<string, LearnPhraseDTO> = {};
        const incorrectPhrases: LearnPhraseDTO[] = [];

        prev.currentRound.forEach((p) => {
          const answer = newAnswers[p.id];
          if (answer && answer.isChecked && answer.isCorrect === false) {
            incorrectPhrasesMap[p.id] = p;
          }
        });

        Object.values(incorrectPhrasesMap).forEach((p) => incorrectPhrases.push(p));

        return {
          ...prev,
          answers: newAnswers,
          correctCount,
          incorrectCount,
          incorrectPhrases,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to check answer.";
      addToast({
        type: "error",
        title: "Check failed",
        description: message,
      });
    }
  };

  const goToNextCard = () => {
    if (session.phase !== "in_progress") return;

    // End of round → show summary
    if (session.currentIndex >= session.currentRound.length - 1) {
      setSession((prev) => ({
        ...prev,
        phase: "round_summary",
      }));
      return;
    }

    setSession((prev) => ({
      ...prev,
      currentIndex: prev.currentIndex + 1,
    }));
  };

  const goToPreviousCard = () => {
    if (session.phase !== "in_progress") return;
    if (session.currentIndex === 0) return;

    setSession((prev) => ({
      ...prev,
      currentIndex: prev.currentIndex - 1,
    }));
  };

  const handleSkip = () => {
    if (!currentPhrase || session.phase !== "in_progress") return;

    // Skip: move to next card without changing stats or incorrect list
    goToNextCard();
  };

  const handleEnterKey = useCallback(() => {
    if (!currentPhrase || session.phase !== "in_progress") return;

    if (!currentCardResult || !currentCardResult.isChecked) {
      void handleCheckAnswer();
      return;
    }

    goToNextCard();
  }, [currentCardResult, currentPhrase, goToNextCard, handleCheckAnswer, session.phase]);

  const handleStartNextRoundWithIncorrect = () => {
    if (!session.incorrectPhrases.length) {
      // Nothing left to repeat – reset to initial screen
      setSession((prev) => ({
        ...createInitialSessionState(),
        direction: prev.direction,
        shuffle: prev.shuffle,
      }));
      return;
    }

    setSession((prev) => ({
      ...prev,
      phase: "in_progress",
      currentRound: shuffleArray(prev.incorrectPhrases),
      currentIndex: 0,
      roundNumber: prev.roundNumber + 1,
      correctCount: 0,
      incorrectCount: 0,
      answers: {},
      incorrectPhrases: [],
    }));
  };

  const handleRestartFromBeginning = () => {
    if (!manifest || !manifest.phrases.length) {
      setSession((prev) => ({
        ...createInitialSessionState(),
        direction: prev.direction,
        shuffle: prev.shuffle,
      }));
      return;
    }

    setSession((prev) => ({
      ...prev,
      phase: "idle",
      currentRound: [],
      currentIndex: 0,
      roundNumber: 1,
      correctCount: 0,
      incorrectCount: 0,
      answers: {},
      incorrectPhrases: [],
    }));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.contentEditable === "true") {
        return;
      }
      if (session.phase !== "in_progress") return;

      if (event.key === "Enter") {
        event.preventDefault();
        handleEnterKey();
      } else if (event.key === " ") {
        event.preventDefault();
        // TODO: integrate audio playback (space toggles play/pause)
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleEnterKey, session.phase]);

  if (!isAuthenticated) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Authentication required</p>
      </div>
    );
  }

  if (manifestLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 bg-muted animate-pulse rounded w-48" />
          <a
            href={`/notebooks/${notebookId}`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to Notebook
          </a>
        </div>
        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <div className="h-10 bg-muted animate-pulse rounded w-1/2" />
          <div className="h-6 bg-muted animate-pulse rounded w-1/3" />
          <div className="h-40 bg-muted animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (manifestError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-foreground">Learn mode</h1>
          <a
            href={`/notebooks/${notebookId}`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to Notebook
          </a>
        </div>
        <div className="p-4 rounded-md bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive">{manifestError}</p>
        </div>
      </div>
    );
  }

  const phraseCount = manifest?.phrase_count ?? 0;

  const renderStartScreen = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Learn mode</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Notebook: <span className="font-mono text-foreground">{notebookId}</span>
          </p>
        </div>
        <a
          href={`/notebooks/${notebookId}`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Notebook
        </a>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Session settings</h2>
          <p className="text-sm text-muted-foreground">Choose direction and order for this learning session.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1.5">Direction</div>
              <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={session.direction === "en_to_pl" ? "default" : "ghost"}
                  className="px-3"
                  onClick={() => handleChangeDirection("en_to_pl")}
                >
                  EN → PL
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={session.direction === "pl_to_en" ? "default" : "ghost"}
                  className="px-3"
                  onClick={() => handleChangeDirection("pl_to_en")}
                >
                  PL → EN
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5">Order</div>
                <button
                  type="button"
                  onClick={handleToggleShuffle}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
                >
                  <div
                    className={`size-4 rounded border ${
                      session.shuffle ? "bg-primary border-primary" : "border-muted-foreground/40"
                    }`}
                    aria-hidden="true"
                  />
                  <span>{session.shuffle ? "Shuffle (recommended)" : "In order"}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-md bg-muted/40 border border-dashed border-border/80 p-4">
            <div className="text-sm font-medium text-foreground">
              {phraseCount === 0
                ? "No phrases"
                : `${phraseCount} phrase${phraseCount === 1 ? "" : "s"} in this notebook`}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You will work card by card. At the end of each round, only incorrect phrases will be repeated in the next
              round.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">ENTER: check / next card · Space: audio (when available)</p>
          <Button type="button" onClick={handleStart} disabled={phraseCount === 0}>
            Start session
          </Button>
        </div>
      </div>
    </div>
  );

  const renderRoundSummary = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Round {session.roundNumber} summary</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Notebook: <span className="font-mono text-foreground">{notebookId}</span>
          </p>
        </div>
        <a
          href={`/notebooks/${notebookId}`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Notebook
        </a>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-5">
        <div className="flex items-baseline gap-4">
          <div className="text-3xl font-semibold text-foreground">
            {session.correctCount}/{session.currentRound.length}
          </div>
          <div className="text-sm text-muted-foreground">correct in round {session.roundNumber}</div>
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2">
            <span className="size-2 rounded-full bg-emerald-500" />
            <span>
              <span className="font-medium text-foreground">{session.correctCount}</span>{" "}
              <span className="text-muted-foreground">correct</span>
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
            <span className="size-2 rounded-full bg-destructive" />
            <span>
              <span className="font-medium text-foreground">{session.incorrectCount}</span>{" "}
              <span className="text-muted-foreground">
                incorrect {session.incorrectPhrases.length > 0 && "(to repeat)"}
              </span>
            </span>
          </div>
        </div>

        {session.incorrectPhrases.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {session.incorrectPhrases.length} phrase
              {session.incorrectPhrases.length === 1 ? " is" : "s are"} marked for the next round.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={handleStartNextRoundWithIncorrect}>
                Start next round with incorrect phrases
              </Button>
              <Button type="button" variant="outline" onClick={handleRestartFromBeginning}>
                Finish session
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-emerald-600 dark:text-emerald-300">
              All phrases were answered correctly in this round. Great job!
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={handleRestartFromBeginning}>
                Start new session from the beginning
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderInProgress = () => {
    if (!currentPhrase) {
      return null;
    }

    const hasAudio = getHasAudio(currentPhrase, session.direction);
    const promptHtml = parseMarkdownToHtml(getPromptText(currentPhrase, session.direction));

    const progressLabel = `Card ${session.currentIndex + 1} / ${session.currentRound.length}`;

    const isChecked = currentCardResult?.isChecked ?? false;
    const isCorrect = currentCardResult?.isCorrect ?? null;

    return (
      <div className="space-y-6" role="region" aria-label="Learn mode session">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Learn mode</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Round {session.roundNumber} · {progressLabel}
            </p>
          </div>
          <a
            href={`/notebooks/${notebookId}`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to Notebook
          </a>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 md:p-6 space-y-5">
          {/* Top bar with stats + audio */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm">
              <div className="px-2.5 py-1 rounded-full bg-muted/60 text-xs font-medium text-muted-foreground">
                {progressLabel}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  Correct: <span className="font-semibold text-foreground">{session.correctCount}</span>
                </span>
                <span className="text-border">•</span>
                <span>
                  Incorrect: <span className="font-semibold text-foreground">{session.incorrectCount}</span>
                </span>
                <span className="text-border">•</span>
                <span>
                  Left in round:{" "}
                  <span className="font-semibold text-foreground">{remainingInRound < 0 ? 0 : remainingInRound}</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                Prompt: {getPromptLanguageLabel(session.direction)} · Answer: {getAnswerLanguageLabel(session.direction)}
              </span>
              <Button
                type="button"
                size="sm"
                disabled={!hasAudio}
                onClick={() => {
                  // TODO: integrate with audio playback (EN or PL slot based on direction)
                }}
              >
                {hasAudio ? "Play audio" : "No audio"}
              </Button>
            </div>
          </div>

          {/* Prompt section */}
          <div className="rounded-md bg-muted/40 border border-border/80 p-4">
            <div
              className="text-sm text-foreground"
              dangerouslySetInnerHTML={{ __html: promptHtml }}
            />
          </div>

          {/* Answer input and feedback */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Your answer ({getAnswerLanguageLabel(session.direction)})
              </label>
              <textarea
                className="w-full min-h-[72px] rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder={
                  session.direction === "en_to_pl" ? "Type the Polish translation…" : "Type the English translation…"
                }
                value={currentCardResult?.userAnswer ?? ""}
                onChange={(e) => handleUserAnswerChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleEnterKey();
                  }
                }}
              />
            </div>

            {/* Global feedback */}
            {isChecked && (
              <div
                className={`px-3 py-2 rounded-md text-sm flex items-center gap-2 ${
                  isCorrect
                    ? "bg-emerald-500/10 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                    : "bg-destructive/10 border border-destructive/40 text-destructive"
                }`}
              >
                <span className="text-lg">{isCorrect ? "✅" : "❌"}</span>
                <span>{isCorrect ? "Correct!" : "Not correct."}</span>
              </div>
            )}

            {/* Textual diff */}
            <AnswerDiffView result={currentCardResult?.backendResult ?? null} />
          </div>

          {/* Navigation controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={session.currentIndex === 0}
                onClick={goToPreviousCard}
              >
                Previous
              </Button>
              <Button type="button" size="sm" onClick={handleSkip}>
                Skip
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {!isChecked && (
                <Button type="button" size="sm" onClick={handleCheckAnswer}>
                  Check answer (Enter)
                </Button>
              )}
              {isChecked && (
                <Button type="button" size="sm" onClick={goToNextCard}>
                  {session.currentIndex >= session.currentRound.length - 1
                    ? "Finish round (Enter)"
                    : "Next card (Enter)"}
                </Button>
              )}
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          ENTER: {isChecked ? "next card / finish round" : "check answer"} · Space: audio (when available)
        </p>
      </div>
    );
  };

  if (session.phase === "idle") {
    return renderStartScreen();
  }

  if (session.phase === "round_summary") {
    return renderRoundSummary();
  }

  return renderInProgress();
}

export default function LearnView(props: LearnViewProps) {
  return (
    <ToastProvider>
      <LearnViewContent {...props} />
    </ToastProvider>
  );
}
