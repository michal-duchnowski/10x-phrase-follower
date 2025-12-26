import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Button } from "./ui/button";
import { ToastProvider, useToast } from "./ui/toast";
import { useApi } from "../lib/hooks/useApi";
import type {
  CheckAnswerResultDTO,
  LearnDirection,
  LearnManifestDTO,
  LearnPhraseDTO,
  NotebookDTO,
  PlaybackManifestDTO,
} from "../types";
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
  correctAnswer: string; // Store original correct answer for diff display
}

interface LearnSessionState {
  phase: SessionPhase;
  direction: LearnDirection;
  shuffle: boolean;
  useContainsMode: boolean; // If true, accept answer if it matches any word in correct answer
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
    useContainsMode: false,
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

function getCorrectAnswer(phrase: LearnPhraseDTO, direction: LearnDirection): string {
  return direction === "en_to_pl" ? phrase.pl_text : phrase.en_text;
}

function getAnswerLanguageLabel(direction: LearnDirection): string {
  return direction === "en_to_pl" ? "Polish" : "English";
}

function getHasAudio(phrase: LearnPhraseDTO, direction: LearnDirection): boolean {
  return direction === "en_to_pl" ? phrase.audio.has_en_audio : phrase.audio.has_pl_audio;
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
  // If normalized strings match, show both as equal
  if (normalizedUser === normalizedCorrect) {
    return {
      userSegments: [{ type: "equal", text: userAnswer || "" }],
      correctSegments: [{ type: "equal", text: correctAnswer || "" }],
    };
  }

  // Simple word-level comparison
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
    // Handle whitespace
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
      // Words match
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
      // Words differ
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

function AnswerDiffView({
  userAnswer,
  correctAnswer,
  result,
}: {
  userAnswer: string;
  correctAnswer: string;
  result: CheckAnswerResultDTO | null;
}) {
  const { userSegments, correctSegments } = useMemo(() => {
    if (!result) {
      return { userSegments: [] as DiffSegment[], correctSegments: [] as DiffSegment[] };
    }
    return diffOriginalStrings(userAnswer, correctAnswer, result.normalized_user, result.normalized_correct);
  }, [userAnswer, correctAnswer, result]);

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
        <div className="text-xs font-medium text-muted-foreground mb-1">Your answer</div>
        <div className="px-3 py-2 rounded-md bg-muted/60 border border-border/60 break-words">
          {userAnswer ? (
            renderSegments(userSegments, true)
          ) : (
            <span className="text-muted-foreground italic">empty</span>
          )}
        </div>
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Correct answer</div>
        <div className="px-3 py-2 rounded-md bg-muted/60 border border-border/60 break-words">
          {correctAnswer ? (
            renderSegments(correctSegments, false)
          ) : (
            <span className="text-muted-foreground italic">empty</span>
          )}
        </div>
      </div>
    </div>
  );
}

function LearnViewContent({ notebookId }: LearnViewProps) {
  const { apiCall, isAuthenticated } = useApi();
  const { addToast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackManifestRef = useRef<PlaybackManifestDTO | null>(null);

  const [manifest, setManifest] = useState<LearnManifestDTO | null>(null);
  const [manifestLoading, setManifestLoading] = useState<boolean>(true);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [notebookName, setNotebookName] = useState<string | null>(null);

  const [session, setSession] = useState<LearnSessionState>(() => createInitialSessionState());

  const currentPhrase: LearnPhraseDTO | null =
    session.phase === "in_progress" && session.currentRound[session.currentIndex]
      ? session.currentRound[session.currentIndex]
      : null;

  const currentCardResult: CardResultState | null =
    currentPhrase && session.answers[currentPhrase.id] ? session.answers[currentPhrase.id] : null;

  const remainingInRound = session.phase === "in_progress" ? session.currentRound.length - session.currentIndex - 1 : 0;

  // Load notebook name and learn manifest when authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const loadData = async () => {
      setManifestLoading(true);
      setManifestError(null);

      try {
        // Load notebook name and manifest in parallel
        const [notebookData, manifestData] = await Promise.all([
          apiCall<NotebookDTO>(`/api/notebooks/${notebookId}`, {
            method: "GET",
          }),
          apiCall<LearnManifestDTO>(`/api/notebooks/${notebookId}/learn-manifest`, {
            method: "GET",
          }),
        ]);

        setNotebookName(notebookData.name);
        setManifest(manifestData);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load learn mode data.";
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

    loadData();
  }, [apiCall, notebookId, isAuthenticated, addToast]);

  // Fetch playback manifest for audio
  const fetchPlaybackManifest = useCallback(
    async (phraseIds: string[]) => {
      if (phraseIds.length === 0) return;

      try {
        const phraseIdsParam = phraseIds.join(",");
        const data = await apiCall<PlaybackManifestDTO>(
          `/api/notebooks/${notebookId}/playback-manifest?phrase_ids=${phraseIdsParam}`,
          {
            method: "GET",
          }
        );
        playbackManifestRef.current = data;
      } catch (err) {
        // Silently fail - audio is optional
        // eslint-disable-next-line no-console
        console.error("[LearnView] Failed to fetch playback manifest:", err);
      }
    },
    [apiCall, notebookId]
  );

  // Fetch playback manifest when starting a round
  useEffect(() => {
    if (session.phase === "in_progress" && session.currentRound.length > 0) {
      const phraseIds = session.currentRound.map((p) => p.id);
      void fetchPlaybackManifest(phraseIds);
    }
  }, [session.phase, session.currentRound, fetchPlaybackManifest]);

  // Auto-play audio when entering a card (Before check state) - only once per card
  const lastAutoPlayedPhraseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentPhrase || session.phase !== "in_progress") {
      return;
    }

    const isChecked = currentCardResult?.isChecked ?? false;
    if (isChecked) {
      return; // Don't auto-play in After check state
    }

    // Only auto-play once per phrase
    if (lastAutoPlayedPhraseIdRef.current === currentPhrase.id) {
      return;
    }

    const hasAudio = getHasAudio(currentPhrase, session.direction);
    if (!hasAudio || !playbackManifestRef.current) {
      return;
    }

    // Find the phrase in playback manifest
    const manifestItem = playbackManifestRef.current.sequence.find((item) => item.phrase.id === currentPhrase.id);

    if (!manifestItem) {
      return;
    }

    // Find appropriate segment based on direction
    let targetSegment = null;
    if (session.direction === "en_to_pl") {
      // Prefer EN1, fallback to EN2 or EN3
      targetSegment =
        manifestItem.segments.find((s) => s.slot === "EN1") ||
        manifestItem.segments.find((s) => s.slot === "EN2") ||
        manifestItem.segments.find((s) => s.slot === "EN3");
    } else {
      // PL → EN: use PL segment
      targetSegment = manifestItem.segments.find((s) => s.slot === "PL");
    }

    if (targetSegment && targetSegment.url) {
      // Auto-play audio only once
      lastAutoPlayedPhraseIdRef.current = currentPhrase.id;
      const audio = new Audio(targetSegment.url);
      audio.playbackRate = 1.0;
      audio.play().catch((err) => {
        // Silently fail - audio auto-play may be blocked by browser
        // eslint-disable-next-line no-console
        console.error("[LearnView] Failed to auto-play audio:", err);
      });
      audioRef.current = audio;

      // Clean up when audio ends
      audio.addEventListener("ended", () => {
        audioRef.current = null;
      });
    }
  }, [currentPhrase, session.direction, session.phase, currentCardResult]);

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

  const handleToggleContainsMode = () => {
    setSession((prev) => ({
      ...prev,
      useContainsMode: !prev.useContainsMode,
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

    // Reset auto-play tracking when starting new round
    lastAutoPlayedPhraseIdRef.current = null;

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

    // Don't allow changes after check
    const isChecked = session.answers[currentPhrase.id]?.isChecked ?? false;
    if (isChecked) {
      return;
    }

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
            correctAnswer: prevState ? prevState.correctAnswer : getCorrectAnswer(currentPhrase, prev.direction),
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
    const correctAnswer = getCorrectAnswer(currentPhrase, session.direction);

    try {
      const result = await apiCall<CheckAnswerResultDTO>(`/api/notebooks/${notebookId}/learn/check-answer`, {
        method: "POST",
        body: JSON.stringify({
          phrase_id: currentPhrase.id,
          user_answer: userAnswer,
          direction: session.direction,
          use_contains_mode: session.useContainsMode,
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
            correctAnswer,
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

  const handleSkip = () => {
    if (!currentPhrase || session.phase !== "in_progress") return;

    // Skip: move to next card without changing stats or incorrect list
    goToNextCard();
  };

  const handleEnterKey = useCallback(() => {
    if (!currentPhrase || session.phase !== "in_progress") return;

    const isChecked = currentCardResult?.isChecked ?? false;

    if (!isChecked) {
      void handleCheckAnswer();
      return;
    }

    goToNextCard();
  }, [currentCardResult, currentPhrase, handleCheckAnswer, session.phase, goToNextCard]);

  const handleStartNextRoundWithIncorrect = () => {
    if (!session.incorrectPhrases.length) {
      // Nothing left to repeat – reset to initial screen
      setSession((prev) => ({
        ...createInitialSessionState(),
        direction: prev.direction,
        shuffle: prev.shuffle,
        useContainsMode: prev.useContainsMode,
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
        useContainsMode: prev.useContainsMode,
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

      // Allow typing in textarea
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
        if (event.key === "Enter" && !event.shiftKey && session.phase === "in_progress") {
          event.preventDefault();
          handleEnterKey();
        }
        return;
      }

      if (session.phase !== "in_progress") return;

      if (event.key === "Enter") {
        event.preventDefault();
        handleEnterKey();
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
            Notebook: <span className="text-foreground">{notebookName || notebookId}</span>
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

            <div className="space-y-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5">Order</div>
                <button
                  type="button"
                  onClick={handleToggleShuffle}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
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

              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5">Answer mode</div>
                <button
                  type="button"
                  onClick={handleToggleContainsMode}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
                >
                  <div
                    className={`size-4 rounded border ${
                      session.useContainsMode ? "bg-primary border-primary" : "border-muted-foreground/40"
                    }`}
                    aria-hidden="true"
                  />
                  <span>
                    {session.useContainsMode
                      ? "Contains mode (any word matches)"
                      : "Exact match (full answer required)"}
                  </span>
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
          <p className="text-xs text-muted-foreground">ENTER: check / next card</p>
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
            Notebook: <span className="text-foreground">{notebookName || notebookId}</span>
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

    const promptHtml = parseMarkdownToHtml(getPromptText(currentPhrase, session.direction));
    const progressLabel = `Card ${session.currentIndex + 1} / ${session.currentRound.length}`;

    const isChecked = currentCardResult?.isChecked ?? false;
    const isCorrect = currentCardResult?.isCorrect ?? null;
    const userAnswer = currentCardResult?.userAnswer ?? "";
    const correctAnswer = currentCardResult?.correctAnswer ?? getCorrectAnswer(currentPhrase, session.direction);

    return (
      <div className="space-y-6" role="region" aria-label="Learn mode session">
        {/* Header with notebook name and progress */}
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
          {/* Passive stats bar - moved to top, small and non-intrusive */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="px-2.5 py-1 rounded-full bg-muted/60 font-medium">{progressLabel}</div>
            <div className="flex items-center gap-2">
              <span>
                Correct: <span className="font-semibold text-foreground">{session.correctCount}</span>
              </span>
              <span className="text-border">•</span>
              <span>
                Incorrect: <span className="font-semibold text-foreground">{session.incorrectCount}</span>
              </span>
              <span className="text-border">•</span>
              <span>
                Left:{" "}
                <span className="font-semibold text-foreground">{remainingInRound < 0 ? 0 : remainingInRound}</span>
              </span>
            </div>
          </div>

          {/* Prompt section */}
          <div className="rounded-md bg-muted/40 border border-border/80 p-4">
            <div className="text-sm text-foreground" dangerouslySetInnerHTML={{ __html: promptHtml }} />
          </div>

          {/* STAN A: Before check - Answering */}
          {!isChecked && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Your answer ({getAnswerLanguageLabel(session.direction)})
                </label>
                <textarea
                  className="w-full min-h-[72px] rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  placeholder={
                    session.direction === "en_to_pl" ? "Type the Polish translation…" : "Type the English translation…"
                  }
                  value={userAnswer}
                  onChange={(e) => handleUserAnswerChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleEnterKey();
                    }
                  }}
                />
              </div>

              {/* Controls - Before check */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button type="button" size="sm" variant="outline" onClick={handleSkip}>
                  Skip
                </Button>
                <Button type="button" size="sm" onClick={handleCheckAnswer}>
                  Check answer
                </Button>
              </div>
            </div>
          )}

          {/* STAN B: After check - Feedback */}
          {isChecked && (
            <div className="space-y-3">
              {/* Result feedback */}
              <div
                className={`px-3 py-2 rounded-md text-sm flex items-center gap-2 ${
                  isCorrect
                    ? "bg-emerald-500/10 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                    : "bg-destructive/10 border border-destructive/40 text-destructive"
                }`}
              >
                <span className="text-lg">{isCorrect ? "✅" : "❌"}</span>
                <span>{isCorrect ? "Correct" : "Not correct"}</span>
              </div>

              {/* Answer diff */}
              <AnswerDiffView
                userAnswer={userAnswer}
                correctAnswer={correctAnswer}
                result={currentCardResult?.backendResult ?? null}
              />

              {/* Controls - After check */}
              <div className="flex justify-end pt-2">
                <Button type="button" size="sm" onClick={goToNextCard}>
                  {session.currentIndex >= session.currentRound.length - 1 ? "Finish round" : "Next card"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          ENTER: {isChecked ? "next card / finish round" : "check answer"}
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
