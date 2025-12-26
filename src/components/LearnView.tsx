import React, { useCallback, useEffect, useState, useRef } from "react";
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
import { compareAnswers } from "../lib/learn.service";
import { compareWordBankAnswer, tokenizePhrase } from "../lib/word-bank.service";
import AnswerDiffView from "./learn/AnswerDiffView";
import PhraseTokenPills from "./learn/PhraseTokenPills";
import WordBank from "./learn/WordBank";

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
  selectedTokens?: string[]; // For word bank mode
}

type AnswerInputMode = "text" | "word_bank" | "hybrid";

interface LearnSessionState {
  phase: SessionPhase;
  direction: LearnDirection;
  shuffle: boolean;
  useContainsMode: boolean; // If true, accept answer if it matches any word in correct answer
  answerInputMode: AnswerInputMode; // "text" or "word_bank"
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
    answerInputMode: "text",
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

/**
 * Determines the effective input mode for a phrase.
 * For hybrid mode: uses text input for 1-2 tokens, word bank for 3+ tokens.
 */
function getEffectiveInputMode(
  answerInputMode: AnswerInputMode,
  phrase: LearnPhraseDTO | null,
  direction: LearnDirection
): "text" | "word_bank" {
  if (answerInputMode === "hybrid" && phrase) {
    const correctAnswer = getCorrectAnswer(phrase, direction);
    const tokenCount = tokenizePhrase(correctAnswer).length;
    return tokenCount <= 2 ? "text" : "word_bank";
  }
  return answerInputMode === "hybrid" ? "text" : answerInputMode;
}

function getHasAudio(phrase: LearnPhraseDTO, direction: LearnDirection): boolean {
  return direction === "en_to_pl" ? phrase.audio.has_en_audio : phrase.audio.has_pl_audio;
}

function LearnViewContent({ notebookId }: LearnViewProps) {
  const { apiCall, isAuthenticated } = useApi();
  const { addToast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackManifestRef = useRef<PlaybackManifestDTO | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isPromptAudioPlaying, setIsPromptAudioPlaying] = useState(false);

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

  // Get effective input mode for current phrase (handles hybrid mode)
  const effectiveInputMode = getEffectiveInputMode(session.answerInputMode, currentPhrase, session.direction);

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
      setIsPromptAudioPlaying(true);
      audio.play().catch((err) => {
        // Silently fail - audio auto-play may be blocked by browser
        // eslint-disable-next-line no-console
        console.error("[LearnView] Failed to auto-play audio:", err);
        setIsPromptAudioPlaying(false);
      });
      audioRef.current = audio;

      // Clean up when audio ends
      audio.addEventListener("ended", () => {
        audioRef.current = null;
        setIsPromptAudioPlaying(false);
      });

      audio.addEventListener("pause", () => {
        setIsPromptAudioPlaying(false);
      });
    }
  }, [currentPhrase, session.direction, session.phase, currentCardResult]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsPromptAudioPlaying(false);
    };
  }, []);

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

  const handleChangeAnswerInputMode = (mode: AnswerInputMode) => {
    setSession((prev) => ({
      ...prev,
      answerInputMode: mode,
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
            selectedTokens: prevState?.selectedTokens,
          },
        },
      };
    });
  };

  const handleWordBankTokenSelect = useCallback(
    (token: string) => {
      if (!currentPhrase) return;

      setSession((prev) => {
        const isChecked = prev.answers[currentPhrase.id]?.isChecked ?? false;
        if (isChecked) {
          return prev;
        }

        const prevState = prev.answers[currentPhrase.id];
        const currentTokens = prevState?.selectedTokens || [];
        const newTokens = [...currentTokens, token];
        const userAnswer = newTokens.join(" ");

        return {
          ...prev,
          answers: {
            ...prev.answers,
            [currentPhrase.id]: {
              isChecked: prevState ? prevState.isChecked : false,
              isCorrect: prevState ? prevState.isCorrect : null,
              backendResult: prevState ? prevState.backendResult : null,
              correctAnswer: prevState ? prevState.correctAnswer : getCorrectAnswer(currentPhrase, prev.direction),
              userAnswer,
              selectedTokens: newTokens,
            },
          },
        };
      });
    },
    [currentPhrase]
  );

  const handleWordBankTokenRemove = useCallback(
    (index: number) => {
      if (!currentPhrase) return;

      setSession((prev) => {
        const isChecked = prev.answers[currentPhrase.id]?.isChecked ?? false;
        if (isChecked) {
          return prev;
        }

        const prevState = prev.answers[currentPhrase.id];
        const currentTokens = prevState?.selectedTokens || [];
        const newTokens = currentTokens.filter((_, i) => i !== index);
        const userAnswer = newTokens.join(" ");

        return {
          ...prev,
          answers: {
            ...prev.answers,
            [currentPhrase.id]: {
              isChecked: prevState ? prevState.isChecked : false,
              isCorrect: prevState ? prevState.isCorrect : null,
              backendResult: prevState ? prevState.backendResult : null,
              correctAnswer: prevState ? prevState.correctAnswer : getCorrectAnswer(currentPhrase, prev.direction),
              userAnswer,
              selectedTokens: newTokens,
            },
          },
        };
      });
    },
    [currentPhrase]
  );

  const handleCheckAnswer = useCallback(async () => {
    if (!currentPhrase) return;

    const correctAnswer = getCorrectAnswer(currentPhrase, session.direction);
    let localComparison: {
      isCorrect: boolean;
      normalizedUser: string;
      normalizedCorrect: string;
    };

    // Use word bank comparison if in word bank mode (or hybrid with 3+ tokens)
    const effectiveMode = getEffectiveInputMode(session.answerInputMode, currentPhrase, session.direction);
    if (effectiveMode === "word_bank") {
      const selectedTokens = currentCardResult?.selectedTokens || [];
      localComparison = compareWordBankAnswer(selectedTokens, correctAnswer);
    } else {
      const userAnswer = currentCardResult?.userAnswer ?? "";
      localComparison = compareAnswers(userAnswer, correctAnswer, session.useContainsMode);
    }

    const result: CheckAnswerResultDTO = {
      is_correct: localComparison.isCorrect,
      normalized_user: localComparison.normalizedUser,
      normalized_correct: localComparison.normalizedCorrect,
    };

    // Update UI immediately with local comparison
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

      const effectiveMode = getEffectiveInputMode(session.answerInputMode, currentPhrase, session.direction);
      const userAnswer =
        effectiveMode === "word_bank"
          ? (currentCardResult?.selectedTokens || []).join(" ")
          : (currentCardResult?.userAnswer ?? "");

      const newAnswers: Record<string, CardResultState> = {
        ...prev.answers,
        [currentPhrase.id]: {
          isChecked: true,
          isCorrect: result.is_correct,
          backendResult: result,
          userAnswer,
          correctAnswer,
          selectedTokens: currentCardResult?.selectedTokens,
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
  }, [
    currentCardResult?.userAnswer,
    currentCardResult?.selectedTokens,
    currentPhrase,
    session.direction,
    session.useContainsMode,
    session.answerInputMode,
  ]);

  const goToNextCard = useCallback(() => {
    setSession((prev) => {
      if (prev.phase !== "in_progress") return prev;

      // End of round → show summary
      if (prev.currentIndex >= prev.currentRound.length - 1) {
        return {
          ...prev,
          phase: "round_summary",
        };
      }

      return {
        ...prev,
        currentIndex: prev.currentIndex + 1,
      };
    });
  }, []);

  const handleSkip = useCallback(() => {
    // Skip: move to next card without changing stats or incorrect list
    goToNextCard();
  }, [goToNextCard]);

  const handleStartNextRoundWithIncorrect = useCallback(() => {
    if (!session.incorrectPhrases.length) {
      // Nothing left to repeat – reset to initial screen
      setSession((prev) => ({
        ...createInitialSessionState(),
        direction: prev.direction,
        shuffle: prev.shuffle,
        useContainsMode: prev.useContainsMode,
        answerInputMode: prev.answerInputMode,
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
  }, [session.incorrectPhrases.length]);

  const handleRestartFromBeginning = useCallback(() => {
    if (!manifest || !manifest.phrases.length) {
      setSession((prev) => ({
        ...createInitialSessionState(),
        direction: prev.direction,
        shuffle: prev.shuffle,
        useContainsMode: prev.useContainsMode,
        answerInputMode: prev.answerInputMode,
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
  }, [manifest]);

  const handleEnterKey = useCallback(() => {
    if (session.phase === "round_summary") {
      // In round summary: Enter starts next round or restarts
      if (session.incorrectPhrases.length > 0) {
        handleStartNextRoundWithIncorrect();
      } else {
        handleRestartFromBeginning();
      }
      return;
    }

    if (!currentPhrase || session.phase !== "in_progress") return;

    const isChecked = currentCardResult?.isChecked ?? false;

    if (!isChecked) {
      // For word bank, only check if answer is complete (auto-check handles this, but allow manual check)
      const effectiveMode = getEffectiveInputMode(session.answerInputMode, currentPhrase, session.direction);
      if (effectiveMode === "word_bank") {
        const selectedTokens = currentCardResult?.selectedTokens || [];
        const correctTokenCount = tokenizePhrase(getCorrectAnswer(currentPhrase, session.direction)).length;
        if (selectedTokens.length === correctTokenCount) {
          void handleCheckAnswer();
        }
        // If incomplete, do nothing (or could show hint)
      } else {
        void handleCheckAnswer();
      }
      return;
    }

    goToNextCard();
  }, [
    currentCardResult,
    currentPhrase,
    handleCheckAnswer,
    session.phase,
    session.answerInputMode,
    session.direction,
    session.incorrectPhrases.length,
    goToNextCard,
    handleStartNextRoundWithIncorrect,
    handleRestartFromBeginning,
  ]);

  // Auto-focus textarea when new phrase appears (not checked yet, text mode only)
  useEffect(() => {
    if (
      session.phase === "in_progress" &&
      currentPhrase &&
      !currentCardResult?.isChecked &&
      effectiveInputMode === "text"
    ) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [currentPhrase, session.phase, currentCardResult?.isChecked, effectiveInputMode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      // Allow typing in textarea
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          handleEnterKey();
        }
        return;
      }

      // Handle Enter and Backspace for in_progress and round_summary phases
      if (session.phase === "in_progress" || session.phase === "round_summary") {
        if (event.key === "Enter") {
          event.preventDefault();
          handleEnterKey();
        }
        // Backspace: remove last token in word bank mode
        if (
          event.key === "Backspace" &&
          session.phase === "in_progress" &&
          effectiveInputMode === "word_bank" &&
          currentPhrase &&
          !currentCardResult?.isChecked
        ) {
          const target = event.target as HTMLElement;
          // Only if not in an input/textarea
          if (target.tagName !== "TEXTAREA" && target.tagName !== "INPUT") {
            const selectedTokens = currentCardResult?.selectedTokens || [];
            if (selectedTokens.length > 0) {
              event.preventDefault();
              handleWordBankTokenRemove(selectedTokens.length - 1);
            }
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleEnterKey, session.phase, effectiveInputMode, currentPhrase, currentCardResult, handleWordBankTokenRemove]);

  if (!isAuthenticated) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:p-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Authentication required</p>
        </div>
      </div>
    );
  }

  if (manifestLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:p-6">
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
      </div>
    );
  }

  if (manifestError) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:p-6">
        <div className="space-y-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Learn mode</h1>
            </div>
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
      </div>
    );
  }

  const phraseCount = manifest?.phrase_count ?? 0;

  const renderStartScreen = () => (
    <div className="space-y-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Learn mode</h1>
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
                <div className="text-xs font-medium text-muted-foreground mb-1.5">Answer input mode</div>
                <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 p-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={session.answerInputMode === "text" ? "default" : "ghost"}
                    className="px-3"
                    onClick={() => handleChangeAnswerInputMode("text")}
                  >
                    Text input
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={session.answerInputMode === "word_bank" ? "default" : "ghost"}
                    className="px-3"
                    onClick={() => handleChangeAnswerInputMode("word_bank")}
                  >
                    Word bank
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={session.answerInputMode === "hybrid" ? "default" : "ghost"}
                    className="px-3"
                    onClick={() => handleChangeAnswerInputMode("hybrid")}
                  >
                    Hybrid
                  </Button>
                </div>
              </div>

              {session.answerInputMode === "text" && (
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
              )}
              {session.answerInputMode === "hybrid" && (
                <div className="text-xs text-muted-foreground">
                  Automatically uses text input for 1-2 words, word bank for 3+ words.
                </div>
              )}
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

        <div className="flex items-center justify-end pt-2">
          <Button type="button" onClick={handleStart} disabled={phraseCount === 0}>
            Start session
          </Button>
        </div>
      </div>
    </div>
  );

  const renderRoundSummary = () => (
    <div className="space-y-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Round {session.roundNumber} summary</h1>
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

    const promptText = getPromptText(currentPhrase, session.direction);
    const promptHtml = parseMarkdownToHtml(promptText);
    const progressLabel = `Card ${session.currentIndex + 1} / ${session.currentRound.length}`;
    const promptLang = session.direction === "en_to_pl" ? "en" : "pl";
    const promptTokens = promptLang === "en" ? currentPhrase.tokens?.en : currentPhrase.tokens?.pl;

    const isChecked = currentCardResult?.isChecked ?? false;
    const isCorrect = currentCardResult?.isCorrect ?? null;
    const userAnswer = currentCardResult?.userAnswer ?? "";
    const correctAnswer = currentCardResult?.correctAnswer ?? getCorrectAnswer(currentPhrase, session.direction);

    return (
      <div className="space-y-6" role="region" aria-label="Learn mode session">
        {/* Header with notebook name and progress */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Learn mode</h1>
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
          <div
            className={`rounded-lg border bg-card px-4 py-3 transition-colors ${
              isPromptAudioPlaying
                ? "bg-yellow-400/10 ring-1 ring-yellow-400/30"
                : isChecked
                  ? isCorrect
                    ? "bg-emerald-500/5 ring-1 ring-emerald-500/30"
                    : "bg-destructive/5 ring-1 ring-destructive/30"
                  : ""
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded border ${
                  promptLang === "en"
                    ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                    : "bg-green-500/20 text-green-300 border-green-500/40"
                }`}
              >
                {promptLang === "en" ? "EN" : "PL"}
              </span>
              {isPromptAudioPlaying && <span className="text-xs text-muted-foreground animate-pulse">●</span>}
            </div>
            {promptTokens && promptTokens.length > 0 ? (
              <PhraseTokenPills
                tokens={promptTokens}
                originalText={promptText}
                highlight={isPromptAudioPlaying}
                size="lg"
              />
            ) : (
              <div
                className="text-base md:text-lg leading-6 md:leading-7 text-foreground"
                dangerouslySetInnerHTML={{ __html: promptHtml }}
              />
            )}
          </div>

          {/* STAN A: Before check - Answering */}
          {!isChecked && (
            <div className="space-y-3">
              {effectiveInputMode === "word_bank" ? (
                <WordBank
                  correctAnswer={correctAnswer}
                  selectedTokens={currentCardResult?.selectedTokens || []}
                  onTokenSelect={handleWordBankTokenSelect}
                  onTokenRemove={handleWordBankTokenRemove}
                  allPhrases={manifest?.phrases || []}
                  currentPhraseId={currentPhrase.id}
                  direction={session.direction}
                  isChecked={false}
                  onAutoCheck={handleCheckAnswer}
                />
              ) : (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Your answer ({getAnswerLanguageLabel(session.direction)})
                  </label>
                  <textarea
                    ref={textareaRef}
                    className="w-full min-h-[72px] rounded-md border border-border bg-card px-3 py-2 text-base md:text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    placeholder={
                      session.direction === "en_to_pl"
                        ? "Type the Polish translation…"
                        : "Type the English translation…"
                    }
                    value={userAnswer}
                    onChange={(e) => handleUserAnswerChange(e.target.value)}
                  />
                </div>
              )}

              {/* Controls - Before check */}
              <div className="hidden sm:flex items-center justify-end gap-3 pt-2">
                <Button type="button" size="sm" onClick={handleSkip}>
                  Skip
                </Button>
                {effectiveInputMode === "text" && (
                  <Button type="button" size="sm" onClick={handleCheckAnswer}>
                    Check answer
                  </Button>
                )}
                {effectiveInputMode === "word_bank" && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCheckAnswer}
                    disabled={(currentCardResult?.selectedTokens || []).length === 0}
                  >
                    Check answer
                  </Button>
                )}
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

              {/* Show word bank in read-only mode if word bank was used */}
              {effectiveInputMode === "word_bank" && (
                <WordBank
                  correctAnswer={correctAnswer}
                  selectedTokens={currentCardResult?.selectedTokens || []}
                  onTokenSelect={() => undefined} // Disabled
                  onTokenRemove={() => undefined} // Disabled
                  allPhrases={manifest?.phrases || []}
                  currentPhraseId={currentPhrase.id}
                  direction={session.direction}
                  isChecked={true}
                />
              )}

              {/* Answer diff */}
              <AnswerDiffView
                userAnswer={userAnswer}
                correctAnswer={correctAnswer}
                result={currentCardResult?.backendResult ?? null}
              />

              {/* Controls - After check */}
              <div className="hidden sm:flex justify-end pt-2">
                <Button type="button" size="sm" onClick={goToNextCard}>
                  {session.currentIndex >= session.currentRound.length - 1 ? "Finish round" : "Next card"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const content =
    session.phase === "idle"
      ? renderStartScreen()
      : session.phase === "round_summary"
        ? renderRoundSummary()
        : renderInProgress();

  const currentIsChecked = currentCardResult?.isChecked ?? false;

  return (
    <div className="max-w-5xl mx-auto px-4 pb-32 md:p-6 md:pb-6">
      {content}

      {/* Mobile action bar (matches Player's fixed bottom controls) */}
      {session.phase === "in_progress" && currentPhrase && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-background/95 backdrop-blur border-t pb-[env(safe-area-inset-bottom)] sm:hidden">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3 justify-end">
            {!currentIsChecked ? (
              <>
                <Button type="button" onClick={handleSkip}>
                  Skip
                </Button>
                {effectiveInputMode === "text" ? (
                  <Button type="button" className="flex-1" onClick={handleCheckAnswer}>
                    Check answer
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="flex-1"
                    onClick={handleCheckAnswer}
                    disabled={(currentCardResult?.selectedTokens || []).length === 0}
                  >
                    Check answer
                  </Button>
                )}
              </>
            ) : (
              <Button type="button" className="flex-1" onClick={goToNextCard}>
                {session.currentIndex >= session.currentRound.length - 1 ? "Finish round" : "Next card"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LearnView(props: LearnViewProps) {
  return (
    <ToastProvider>
      <LearnViewContent {...props} />
    </ToastProvider>
  );
}
