import { useCallback, useEffect, useRef, useState } from "react";
import IllustrationWizard from "./IllustrationWizard";
import {
  ArchiveX,
  Flag,
  CheckCircle2,
  Flame,
  Info,
  LoaderCircle,
  Play,
  Plus,
  Settings2,
  Download,
  Volume2,
  XCircle,
  Sparkles,
} from "lucide-react";
import { Button } from "./ui/button";
import { ToastProvider, useToast } from "./ui/toast";
import { useApi } from "../lib/hooks/useApi";
import { useFlashcardViewport } from "../lib/hooks/useFlashcardViewport";
import { usePrefetchPhraseImage } from "../lib/hooks/usePrefetchPhraseImage";
import { checkFlashcardAnswer, shouldRequireExactEnglishMatch } from "../lib/fsrs.service";
import { FlashcardAudioCache } from "../lib/flashcard-audio-cache";
import PhraseLearningHintModal from "./PhraseLearningHintModal";
import StoryModal from "./StoryModal";
import PhraseImage from "./PhraseImage";
import { DEFAULT_IMAGE_MAX_WIDTH, DEFAULT_IMAGE_MAX_HEIGHT } from "../lib/phrase-image";
import { parseMarkdownToHtml } from "../lib/utils";
import type { LearnManifestDTO } from "../types";
import { createNotebookTrainingCards } from "../lib/notebook-training";

interface FlashcardsViewProps {
  notebookTraining?: { manifestUrl: string; returnUrl: string };
}

interface SessionCard {
  direction_id: string;
  phrase_id: string;
  direction: "en_to_pl" | "pl_to_en";
  prompt_text: string;
  expected_answer: string;
  en_text: string;
  pl_text: string;
  learning_hint_markdown: string | null;
  image_url?: string | null;
}
interface Overview {
  due_reviews: number;
  overdue_reviews: number;
  new_phrases: number;
  active_flashcards: number;
  new_phrases_today: number;
  can_add_new_phrases: boolean;
  settings: {
    new_phrases_per_batch: number;
    review_cards_per_batch: number;
    drill_repetitions: number;
    difficult_cards_per_training: number;
    image_max_width?: number;
    image_max_height?: number;
  };
}
type Rating = "Again" | "Hard" | "Good" | "Easy";
type SessionMode = "daily" | "training";
type DifficultCardPool = "most_difficult" | "recent_again" | "recent_again_or_hard" | "frequent_lapses";
interface DifficultCard {
  flashcard_id: string;
  phrase_id: string;
  direction_id: string;
  direction: "en_to_pl" | "pl_to_en";
  en_text: string;
  pl_text: string;
  learning_hint_markdown: string | null;
  image_url?: string | null;
  phrase_difficulty: "easy" | "medium" | "hard" | null;
  score: number;
  lapses: number;
  stability: number;
  state: string;
  recent_again_or_hard: number;
}

function FlashcardsContent({ notebookTraining }: FlashcardsViewProps) {
  const { apiCall, isAuthenticated } = useApi();
  const { addToast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCacheRef = useRef<FlashcardAudioCache | null>(null);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [cards, setCards] = useState<SessionCard[]>([]);
  const [index, setIndex] = useState(0);
  const [sessionMode, setSessionMode] = useState<SessionMode>("daily");
  const [trainingCompleted, setTrainingCompleted] = useState(false);
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState<{ kind: string } | null>(null);
  const [drillActive, setDrillActive] = useState(false);
  const [drillStreak, setDrillStreak] = useState(0);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isSavingHint, setIsSavingHint] = useState(false);
  const [hintSaveError, setHintSaveError] = useState<string | null>(null);
  const [difficultOpen, setDifficultOpen] = useState(false);
  const [difficultCards, setDifficultCards] = useState<DifficultCard[]>([]);
  const [difficultLoading, setDifficultLoading] = useState(false);
  const [difficultPool, setDifficultPool] = useState<DifficultCardPool>("recent_again");
  const [editingDifficultHint, setEditingDifficultHint] = useState<DifficultCard | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyPhraseIds, setStoryPhraseIds] = useState<string[]>([]);
  const [notebookLoading, setNotebookLoading] = useState(Boolean(notebookTraining));
  const [notebookError, setNotebookError] = useState<string | null>(null);
  const notebookManifestUrl = notebookTraining?.manifestUrl;
  const current = cards[index];
  usePrefetchPhraseImage(current?.image_url);
  const loadOverview = async () => {
    try {
      setOverview(await apiCall<Overview>("/api/flashcards/overview"));
    } catch {
      /* AuthGuard presents authentication state. */
    }
  };
  const loadDifficultCards = async (pool = difficultPool) => {
    setDifficultLoading(true);
    try {
      const data = await apiCall<{ items: DifficultCard[] }>(`/api/flashcards/difficult?pool=${pool}`);
      setDifficultCards(data.items);
      setDifficultOpen(true);
      setCards([]);
      setTrainingCompleted(false);
    } catch (error) {
      addToast({
        type: "error",
        title: "Could not load difficult cards",
        description: error instanceof Error ? error.message : "Try again",
      });
    } finally {
      setDifficultLoading(false);
    }
  };
  const archiveFlashcard = async (flashcardId: string) => {
    if (!confirm("Remove this phrase from Flashcards? Its phrase and review history will be kept.")) return;
    try {
      await apiCall(`/api/flashcards/${flashcardId}/archive`, { method: "POST" });
      setDifficultCards((previous) => previous.filter((card) => card.flashcard_id !== flashcardId));
      addToast({
        type: "success",
        title: "Removed from Flashcards",
        description: "The phrase can be re-added later with its learning history.",
      });
      await loadOverview();
    } catch (error) {
      addToast({
        type: "error",
        title: "Could not remove flashcard",
        description: error instanceof Error ? error.message : "Try again",
      });
    }
  };
  const toggleDifficultCardHard = async (card: DifficultCard) => {
    const difficulty = card.phrase_difficulty === "hard" ? null : "hard";
    try {
      const updated = await apiCall<{ difficulty: "easy" | "medium" | "hard" | null }>(
        `/api/phrases/${card.phrase_id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ difficulty }),
        }
      );
      setDifficultCards((previous) =>
        previous.map((item) =>
          item.phrase_id === card.phrase_id ? { ...item, phrase_difficulty: updated.difficulty } : item
        )
      );
      addToast({
        type: "success",
        title: difficulty === "hard" ? "Marked as hard" : "Hard mark removed",
      });
    } catch (error) {
      addToast({
        type: "error",
        title: "Could not update difficulty",
        description: error instanceof Error ? error.message : "Try again",
      });
    }
  };
  useEffect(() => {
    if (isAuthenticated) void loadOverview();
  }, [isAuthenticated]);
  const startNotebookTraining = useCallback(async () => {
    if (!notebookManifestUrl) return;
    setNotebookLoading(true);
    setNotebookError(null);
    try {
      const manifest = await apiCall<LearnManifestDTO>(notebookManifestUrl);
      const trainingCards = createNotebookTrainingCards(manifest.phrases);
      setCards(trainingCards);
      setIndex(0);
      setSessionMode("training");
      setTrainingCompleted(false);
      setAnswer("");
      setChecked(null);
      setDrillActive(false);
      setDrillStreak(0);
      setDetailsOpen(false);
      if (!trainingCards.length) setNotebookError("No phrases match this selection.");
    } catch (error) {
      setNotebookError(error instanceof Error ? error.message : "Could not load training");
    } finally {
      setNotebookLoading(false);
    }
  }, [apiCall, notebookManifestUrl]);
  useEffect(() => {
    if (isAuthenticated) void startNotebookTraining();
  }, [isAuthenticated, startNotebookTraining]);
  useEffect(() => {
    const cache = FlashcardAudioCache.forBrowser(async (phraseId) => {
      const { url } = await apiCall<{ url: string | null }>(
        `/api/flashcards/audio?phrase_id=${encodeURIComponent(phraseId)}`
      );
      return url;
    });
    audioCacheRef.current = cache;
    return () => {
      cache.dispose();
      if (audioCacheRef.current === cache) audioCacheRef.current = null;
    };
  }, [apiCall]);
  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    []
  );
  useEffect(() => {
    const phraseIds = cards.slice(index, index + 3).map((card) => card.phrase_id);
    if (phraseIds.length > 0) void audioCacheRef.current?.prefetchWindow(phraseIds);
  }, [cards, index]);
  useEffect(() => {
    if (!current || detailsOpen || (checked && !drillActive)) return;
    const frame = window.requestAnimationFrame(() => answerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [current?.direction_id, checked, detailsOpen, drillActive]);
  useFlashcardViewport(answerRef, actionsRef, {
    active: Boolean(current),
    answer,
    editing: !checked || drillActive,
  });
  useEffect(() => {
    const handleRatingShortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drillActive && !busy && !detailsOpen) {
        event.preventDefault();
        setDrillActive(false);
        return;
      }
      if (!checked || busy || detailsOpen || drillActive) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      if (event.key === "8") {
        event.preventDefault();
        setHintSaveError(null);
        setDetailsOpen(true);
        return;
      }
      if (event.key === "9") {
        event.preventDefault();
        startDrill();
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        void playEnglish();
        return;
      }
      if (event.key.toLowerCase() === "r" && checked.kind !== "manual") {
        event.preventDefault();
        setDrillActive(true);
        setDrillStreak(0);
        setAnswer("");
        window.requestAnimationFrame(() => answerRef.current?.focus());
        return;
      }
      const ratings: Record<string, Rating> =
        sessionMode === "training"
          ? { "1": "Again", "3": "Good" }
          : { "1": "Again", "2": "Hard", "3": "Good", "4": "Easy" };
      const rating = ratings[event.key];
      if (!rating) return;
      event.preventDefault();
      void rate(rating);
    };
    window.addEventListener("keydown", handleRatingShortcut);
    return () => window.removeEventListener("keydown", handleRatingShortcut);
  }, [checked, busy, detailsOpen, drillActive, current, sessionMode]);
  const start = async (includeMoreNew = false) => {
    setBusy(true);
    try {
      const data = await apiCall<{ cards: SessionCard[] }>("/api/flashcards/session", {
        method: "POST",
        body: JSON.stringify({ include_more_new: includeMoreNew }),
      });
      setCards(data.cards);
      setIndex(0);
      setSessionMode("daily");
      setTrainingCompleted(false);
      setAnswer("");
      setChecked(null);
      setDrillActive(false);
      setDrillStreak(0);
      setDetailsOpen(false);
      await loadOverview();
    } catch (error) {
      addToast({
        type: "error",
        title: "Could not start session",
        description: error instanceof Error ? error.message : "Try again",
      });
    } finally {
      setBusy(false);
    }
  };
  const startTraining = () => {
    if (!difficultCards.length) return;
    setCards(
      difficultCards.map((card) => ({
        direction_id: card.direction_id,
        phrase_id: card.phrase_id,
        direction: card.direction,
        prompt_text: card.direction === "en_to_pl" ? card.en_text : card.pl_text,
        expected_answer: card.direction === "en_to_pl" ? card.pl_text : card.en_text,
        en_text: card.en_text,
        pl_text: card.pl_text,
        learning_hint_markdown: card.learning_hint_markdown,
        image_url: card.image_url ?? null,
      }))
    );
    setIndex(0);
    setSessionMode("training");
    setTrainingCompleted(false);
    setAnswer("");
    setChecked(null);
    setDrillActive(false);
    setDrillStreak(0);
    setDetailsOpen(false);
    setDifficultOpen(false);
  };
  const playEnglish = async () => {
    if (!current) return;
    try {
      const url = await audioCacheRef.current?.get(current.phrase_id);
      if (!url) return;
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      await audio.play();
    } catch {
      addToast({
        type: "error",
        title: "Audio could not play",
        description: "The phrase may not have English audio yet.",
      });
    }
  };
  const saveLearningHint = async (value: string | null) => {
    if (!current) return;
    setIsSavingHint(true);
    setHintSaveError(null);
    try {
      const updated = await apiCall<{ learning_hint_markdown: string | null }>(`/api/phrases/${current.phrase_id}`, {
        method: "PATCH",
        body: JSON.stringify({ learning_hint_markdown: value }),
      });
      setCards((previous) =>
        previous.map((card) =>
          card.phrase_id === current.phrase_id
            ? { ...card, learning_hint_markdown: updated.learning_hint_markdown }
            : card
        )
      );
      setDetailsOpen(false);
      addToast({
        type: "success",
        title: "Learning hint saved",
        description: value ? "The hint was updated." : "The hint was cleared.",
      });
    } catch (error) {
      setHintSaveError(error instanceof Error ? error.message : "Failed to save learning hint");
    } finally {
      setIsSavingHint(false);
    }
  };
  const saveImage = async (url: string | File | null, phraseId: string) => {
    setIsSavingHint(true);
    setHintSaveError(null);
    try {
      const updated = await apiCall<{ image_url: string | null }>(
        `/api/phrases/${phraseId}${url instanceof File ? "/image" : ""}`,
        {
          method: url instanceof File ? "POST" : "PATCH",
          headers: url instanceof File ? { "Content-Type": url.type || "application/octet-stream" } : {},
          body: url instanceof File ? url : JSON.stringify({ image_url: url }),
        }
      );
      setCards((previous) =>
        previous.map((card) => (card.phrase_id === phraseId ? { ...card, image_url: updated.image_url } : card))
      );
      setDifficultCards((previous) =>
        previous.map((card) => (card.phrase_id === phraseId ? { ...card, image_url: updated.image_url } : card))
      );
      setDetailsOpen(false);
      setEditingDifficultHint(null);
      addToast({ type: "success", title: updated.image_url ? "Image link saved" : "Image link removed" });
    } catch (error) {
      setHintSaveError(error instanceof Error ? error.message : "Could not save image link");
    } finally {
      setIsSavingHint(false);
    }
  };
  const saveDifficultLearningHint = async (value: string | null) => {
    if (!editingDifficultHint) return;
    setIsSavingHint(true);
    setHintSaveError(null);
    try {
      const updated = await apiCall<{ learning_hint_markdown: string | null }>(
        `/api/phrases/${editingDifficultHint.phrase_id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ learning_hint_markdown: value }),
        }
      );
      setDifficultCards((previous) =>
        previous.map((card) =>
          card.phrase_id === editingDifficultHint.phrase_id
            ? { ...card, learning_hint_markdown: updated.learning_hint_markdown }
            : card
        )
      );
      setEditingDifficultHint(null);
      addToast({
        type: "success",
        title: "Learning hint saved",
        description: value ? "The hint was updated." : "The hint was cleared.",
      });
    } catch (error) {
      setHintSaveError(error instanceof Error ? error.message : "Failed to save learning hint");
    } finally {
      setIsSavingHint(false);
    }
  };
  const check = () => {
    if (!current) return;
    const match = checkFlashcardAnswer(answer, current.expected_answer, {
      exactOnly: shouldRequireExactEnglishMatch(current.direction, current.expected_answer),
    });
    const kind = answer.trim().length === 0 ? "manual" : match.kind === "incorrect" ? "manual" : match.kind;
    if (drillActive) {
      if (kind === "exact" || kind === "contains") {
        const nextStreak = drillStreak + 1;
        setDrillStreak(nextStreak);
        if (nextStreak >= (overview?.settings.drill_repetitions ?? 3)) setDrillActive(false);
      } else {
        setDrillStreak(0);
      }
      setAnswer("");
      void playEnglish();
      return;
    }
    answerRef.current?.blur();
    setChecked({ kind });
    void playEnglish();
  };
  const startDrill = () => {
    setDrillActive(true);
    setDrillStreak(0);
    setAnswer("");
    window.requestAnimationFrame(() => answerRef.current?.focus());
  };
  const rate = (rating: Rating) => {
    if (!current || !checked) return;
    audioRef.current?.pause();
    if (sessionMode === "training") {
      setCards((previous) => (rating === "Again" ? [...previous.slice(1), previous[0]] : previous.slice(1)));
      setIndex(0);
      setTrainingCompleted(rating === "Good" && cards.length === 1);
      setAnswer("");
      setChecked(null);
      setDrillActive(false);
      setDrillStreak(0);
      setDetailsOpen(false);
      return;
    }
    const review = { flashcard_direction_id: current.direction_id, user_answer: answer, fsrs_rating: rating };
    const completedSession = index + 1 >= cards.length;
    setIndex((value) => value + 1);
    setAnswer("");
    setChecked(null);
    setDrillActive(false);
    setDrillStreak(0);
    setDetailsOpen(false);
    void apiCall("/api/flashcards/reviews", { method: "POST", body: JSON.stringify(review) })
      .then(() => {
        if (completedSession) void loadOverview();
      })
      .catch((error) => {
        addToast({
          type: "error",
          title: "Review was not saved",
          description: error instanceof Error ? error.message : "Open a new session to retry this card.",
        });
      });
  };
  const saveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await apiCall("/api/flashcards/settings", {
        method: "PATCH",
        body: JSON.stringify({
          new_phrases_per_batch: Number(form.get("new")),
          review_cards_per_batch: Number(form.get("reviews")),
          drill_repetitions: Number(form.get("drillRepetitions")),
          difficult_cards_per_training: Number(form.get("difficultCardsPerTraining")),
          image_max_width: Number(form.get("imageMaxWidth")),
          image_max_height: Number(form.get("imageMaxHeight")),
        }),
      });
      setSettingsOpen(false);
      await loadOverview();
    } finally {
      setBusy(false);
    }
  };
  if (notebookTraining && (notebookLoading || notebookError))
    return (
      <section className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-semibold">Notebook training</h1>
        {notebookLoading ? (
          <p className="mt-4" role="status">
            Loading training…
          </p>
        ) : (
          <>
            <p className="mt-4 text-muted-foreground" role="alert">
              {notebookError}
            </p>
            <Button className="mt-4" onClick={() => void startNotebookTraining()}>
              Try again
            </Button>
          </>
        )}
        <Button asChild variant="secondary" className="mt-4 ml-2">
          <a href={notebookTraining.returnUrl}>Back to notebook</a>
        </Button>
      </section>
    );
  if (notebookTraining && trainingCompleted)
    return (
      <section className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-semibold">Training session completed</h1>
        <p className="mt-2 text-muted-foreground">No review statistics or schedule were changed.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => void startNotebookTraining()}>
            <Play /> Train again
          </Button>
          <Button asChild variant="secondary">
            <a href={notebookTraining.returnUrl}>Back to notebook</a>
          </Button>
        </div>
      </section>
    );
  if (trainingCompleted || (cards.length && !current))
    return (
      <section className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-semibold">
          {trainingCompleted ? "Training session completed" : "Daily session completed"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {trainingCompleted ? "No review statistics or schedule were changed." : "Your reviews have been saved."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={() => void start()}>
            <Play />
            Start session
          </Button>
          {overview?.can_add_new_phrases && (
            <Button variant="secondary" onClick={() => void start(true)}>
              <Plus />
              Add {overview.settings.new_phrases_per_batch} new phrases
            </Button>
          )}
          <Button
            variant="secondary"
            className="bg-amber-400 text-black hover:bg-amber-300"
            onClick={() => void loadDifficultCards()}
            disabled={difficultLoading}
          >
            {difficultLoading ? <LoaderCircle className="animate-spin" /> : <Flame />}
            Most difficult flashcards
          </Button>
        </div>
      </section>
    );
  if (current) {
    const isMatch = checked?.kind === "exact" || checked?.kind === "contains" || checked?.kind === "typo";
    const isManual = checked?.kind === "manual" && answer.trim().length === 0;
    const drillTarget = overview?.settings.drill_repetitions ?? 3;
    return (
      <section className="mx-auto max-w-2xl py-1 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:py-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:mb-4">
          {notebookTraining && (
            <Button asChild variant="ghost" size="sm" className="min-h-11 px-0 sm:px-3">
              <a href={notebookTraining.returnUrl}>Back to notebook</a>
            </Button>
          )}
          <div className="flex flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground sm:text-sm">
            <span>
              {sessionMode === "training"
                ? `${cards.length} cards to master`
                : `${cards.length - index} cards remaining`}
            </span>
            <span>{current.direction === "en_to_pl" ? "English to Polish" : "Polish to English"}</span>
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-3 shadow-sm sm:px-6 sm:py-5">
          <div
            className="text-xl leading-7 text-foreground sm:text-2xl sm:leading-8"
            dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(current.prompt_text) }}
          />
        </div>
        <label htmlFor="flashcard-answer" className="mt-3 block text-sm font-medium text-foreground sm:mt-4">
          {drillActive ? `Drill: ${drillStreak} / ${drillTarget} consecutive correct answers` : "Your answer"}
        </label>
        <textarea
          id="flashcard-answer"
          ref={answerRef}
          rows={1}
          value={answer}
          disabled={(Boolean(checked) && !drillActive) || busy}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              check();
            }
          }}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="Type your answer"
          className="mt-1 min-h-11 w-full resize-none overflow-y-auto sm:mt-2 sm:min-h-[72px] rounded-md border border-input bg-card p-3 text-lg text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {drillActive ? (
          <div
            ref={actionsRef}
            className="fixed inset-x-0 bottom-[var(--flashcard-keyboard-inset,0px)] z-20 gap-2 border-t border-border bg-card p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none flex sm:mt-3 sm:flex-wrap"
          >
            <Button
              className="min-h-11 flex-1 bg-primary text-primary-foreground hover:bg-primary/90 sm:flex-none"
              onClick={check}
              onPointerDown={(event) => event.preventDefault()}
              disabled={busy}
            >
              Check drill answer
            </Button>
            <Button
              variant="secondary"
              onClick={() => setDrillActive(false)}
              disabled={busy}
              className="min-h-11 flex-1 sm:flex-none"
              title="Back to rating (shortcut: Esc)"
            >
              Back to rating
            </Button>
          </div>
        ) : !checked ? (
          <div
            ref={actionsRef}
            className="fixed inset-x-0 bottom-[var(--flashcard-keyboard-inset,0px)] z-20 gap-2 border-t border-border bg-card p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:mt-3"
          >
            <Button
              className="min-h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90 sm:w-auto"
              onClick={check}
              onPointerDown={(event) => event.preventDefault()}
              disabled={busy}
            >
              Check answer
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-2 rounded-md border border-border bg-card p-3 shadow-sm sm:mt-4 sm:space-y-3 sm:p-4">
            {!isManual && (
              <div
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${isMatch ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-destructive/40 bg-destructive/10 text-destructive"}`}
              >
                {isMatch ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                {isMatch ? (checked.kind === "exact" ? "Correct" : "Partial match") : "Not correct"}
              </div>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-2 sm:flex sm:justify-between sm:gap-4">
              <p className="self-center text-sm font-medium text-foreground sm:hidden">Expected answer</p>
              <div className="hidden min-w-0 flex-1 sm:block">
                <p className="text-sm font-medium text-foreground">Expected answer</p>
                <div
                  className="mt-1 text-xl leading-7 text-foreground sm:text-2xl sm:leading-8"
                  dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(current.expected_answer) }}
                />
              </div>
              {current.image_url && (
                <div className="order-4 col-span-2 min-w-0 sm:order-none sm:flex-1">
                  <PhraseImage
                    key={`${current.phrase_id}:${current.image_url}`}
                    url={current.image_url}
                    revealed={Boolean(checked)}
                    enlargeShortcut={!busy && !detailsOpen && !drillActive}
                    compactMobile
                    maxWidth={overview?.settings.image_max_width ?? DEFAULT_IMAGE_MAX_WIDTH}
                    maxHeight={overview?.settings.image_max_height ?? DEFAULT_IMAGE_MAX_HEIGHT}
                  />
                </div>
              )}
              <div className="flex shrink-0 gap-1 sm:gap-2">
                <Button
                  variant="secondary"
                  size="icon"
                  className="size-11 sm:size-9"
                  onClick={() => {
                    setHintSaveError(null);
                    setDetailsOpen(true);
                  }}
                  title="Description (shortcut: 8)"
                  aria-label="Description. Shortcut: 8"
                >
                  <Info />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  className="size-11 sm:size-9"
                  onClick={startDrill}
                  title={`Drill: ${drillTarget} consecutive correct answers (shortcut: 9)`}
                  aria-label={`Drill: ${drillTarget} consecutive correct answers. Shortcut: 9`}
                >
                  <span className="text-sm font-bold">{drillTarget}×</span>
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  className="size-11 sm:size-9"
                  onClick={() => void playEnglish()}
                  title="Play English audio (shortcut: 0)"
                  aria-label="Play English audio. Shortcut: 0"
                >
                  <Volume2 />
                </Button>
              </div>
              <div
                className="col-span-2 text-xl leading-7 text-foreground sm:hidden"
                dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(current.expected_answer) }}
              />
            </div>
            {!isMatch && !isManual && (
              <p className="text-sm text-muted-foreground">Choose the rating that reflects your recall.</p>
            )}
            <div
              ref={actionsRef}
              role="group"
              aria-label="Recall rating"
              className={`fixed inset-x-0 bottom-[var(--flashcard-keyboard-inset,0px)] z-20 gap-2 border-t border-border bg-card p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none grid sm:rounded-none ${sessionMode === "training" ? "grid-cols-2" : "grid-cols-4"}`}
            >
              {(sessionMode === "training"
                ? (["Again", "Good"] as const)
                : (["Again", "Hard", "Good", "Easy"] as const)
              ).map((rating) => (
                <Button
                  key={rating}
                  className={`${ratingButtonClass(rating)} min-h-11 px-2 sm:min-h-9 sm:px-4`}
                  onClick={() => rate(rating)}
                >
                  {rating}
                </Button>
              ))}
            </div>
          </div>
        )}
        <PhraseLearningHintModal
          open={detailsOpen}
          phraseLabel={`${current.en_text} / ${current.pl_text}`}
          initialValue={current.learning_hint_markdown}
          imageUrl={current.image_url}
          onSaveImage={(url) => void saveImage(url, current.phrase_id)}
          isSaving={isSavingHint}
          error={hintSaveError}
          onSave={saveLearningHint}
          onClose={() => {
            if (!isSavingHint) setDetailsOpen(false);
          }}
        />
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-3xl py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Flashcards</h1>
          <p className="mt-1 text-muted-foreground">Long-term practice for selected phrases.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="icon"
            className="bg-amber-400 text-black hover:bg-amber-300"
            onClick={() => void loadDifficultCards()}
            disabled={difficultLoading}
            title="Most difficult flashcards"
            aria-label="Most difficult flashcards"
          >
            {difficultLoading ? <LoaderCircle className="animate-spin" /> : <Flame />}
          </Button>
          <Button variant="secondary" size="icon" className="bg-violet-500 text-white hover:bg-violet-400" asChild>
            <a href="/flashcards/export" title="Export flashcards" aria-label="Export flashcards">
              <Download />
            </a>
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="bg-sky-400 text-black hover:bg-sky-300"
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Flashcard settings"
            aria-label="Flashcard settings"
          >
            <Settings2 />
          </Button>
        </div>
      </div>
      {settingsOpen && overview && (
        <form
          onSubmit={saveSettings}
          className="mt-6 grid gap-4 rounded-md border border-border bg-card p-4 shadow-sm sm:grid-cols-4"
        >
          <label className="text-sm font-medium text-foreground">
            New phrases per batch
            <input
              name="new"
              type="number"
              min="0"
              max="100"
              defaultValue={overview.settings.new_phrases_per_batch}
              className="mt-1 w-full rounded-md border border-input bg-background p-2 text-foreground"
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Reviews per batch
            <input
              name="reviews"
              type="number"
              min="1"
              max="500"
              defaultValue={overview.settings.review_cards_per_batch}
              className="mt-1 w-full rounded-md border border-input bg-background p-2 text-foreground"
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Drill repetitions
            <input
              name="drillRepetitions"
              type="number"
              min="1"
              max="10"
              defaultValue={overview.settings.drill_repetitions}
              className="mt-1 w-full rounded-md border border-input bg-background p-2 text-foreground"
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Difficult cards in training
            <input
              name="difficultCardsPerTraining"
              type="number"
              min="1"
              max="100"
              defaultValue={overview.settings.difficult_cards_per_training}
              className="mt-1 w-full rounded-md border border-input bg-background p-2 text-foreground"
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Image max width (px)
            <input
              name="imageMaxWidth"
              type="number"
              min="120"
              max="480"
              required
              defaultValue={overview.settings.image_max_width ?? DEFAULT_IMAGE_MAX_WIDTH}
              className="mt-1 w-full rounded-md border border-input bg-background p-2 text-foreground"
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Image max height (px)
            <input
              name="imageMaxHeight"
              type="number"
              min="90"
              max="360"
              required
              defaultValue={overview.settings.image_max_height ?? DEFAULT_IMAGE_MAX_HEIGHT}
              className="mt-1 w-full rounded-md border border-input bg-background p-2 text-foreground"
            />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Images fit within these limits without cropping or stretching. Smaller images keep their original size.
          </p>
          <div className="flex flex-wrap gap-2 sm:col-span-4">
            <Button type="submit" disabled={busy} className="bg-primary text-primary-foreground">
              Save settings
            </Button>
          </div>
        </form>
      )}
      {difficultOpen && (
        <section className="mt-6 border-y border-border py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-3 sm:contents">
              <h2 className="text-base font-semibold text-foreground">Difficult cards</h2>
              <Button variant="ghost" size="sm" onClick={() => setDifficultOpen(false)} className="sm:order-3">
                Close
              </Button>
            </div>
            <select
              value={difficultPool}
              onChange={(event) => {
                const pool = event.target.value as DifficultCardPool;
                setDifficultPool(pool);
                void loadDifficultCards(pool);
              }}
              aria-label="Difficult card pool"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground sm:w-auto"
            >
              <option value="recent_again">Again in last 90 days</option>
              <option value="recent_again_or_hard">Again + Hard in last 90 days</option>
              <option value="most_difficult">Most difficult</option>
              <option value="frequent_lapses">Frequently incorrect</option>
            </select>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <IllustrationWizard
                phrases={difficultCards.map((card) => ({ ...card, id: card.phrase_id }))}
                onImported={(id, imageUrl) =>
                  setDifficultCards((previous) =>
                    previous.map((card) => (card.phrase_id === id ? { ...card, image_url: imageUrl } : card))
                  )
                }
              />
              {difficultCards.length > 0 && (
                <>
                  <Button
                    onClick={() => {
                      setStoryPhraseIds(difficultCards.map((card) => card.phrase_id));
                      setStoryOpen(true);
                    }}
                    disabled={difficultCards.length < 3}
                    title="At least 3 difficult flashcards are needed to create a story"
                  >
                    <Sparkles /> Create story
                  </Button>
                  <Button onClick={startTraining}>
                    <Play /> Start training
                  </Button>
                </>
              )}
            </div>
          </div>
          {difficultCards.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">No difficult flashcards yet.</p>
          ) : (
            <div className="mt-5 divide-y divide-border">
              {difficultCards.map((card) => (
                <div key={card.direction_id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div
                      className="break-words font-medium text-foreground [&>p]:m-0"
                      dangerouslySetInnerHTML={{
                        __html: parseMarkdownToHtml(card.direction === "en_to_pl" ? card.en_text : card.pl_text),
                      }}
                    />
                    <div
                      className="mt-1 break-words text-sm text-muted-foreground [&>p]:m-0"
                      dangerouslySetInnerHTML={{
                        __html: parseMarkdownToHtml(card.direction === "en_to_pl" ? card.pl_text : card.en_text),
                      }}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {difficultPool === "recent_again" || difficultPool === "recent_again_or_hard" ? (
                        <>
                          {card.recent_again_or_hard} {difficultPool === "recent_again" ? "Again" : "Again/Hard"} in 90d
                          · {card.lapses} lapses · stability {card.stability}d
                        </>
                      ) : (
                        <>
                          Score {card.score} · {card.lapses} lapses · stability {card.stability}d ·{" "}
                          {card.recent_again_or_hard} recent Again/Hard
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant={card.learning_hint_markdown ? "default" : "secondary"}
                      size="icon"
                      onClick={() => {
                        setHintSaveError(null);
                        setEditingDifficultHint(card);
                      }}
                      title="Description"
                      aria-label="Description"
                    >
                      <Info />
                    </Button>
                    <Button
                      variant={card.phrase_difficulty === "hard" ? "default" : "secondary"}
                      size="icon"
                      className={
                        card.phrase_difficulty === "hard"
                          ? "hidden bg-emerald-500 text-black hover:bg-emerald-400 landscape:inline-flex sm:inline-flex"
                          : "hidden landscape:inline-flex sm:inline-flex"
                      }
                      onClick={() => void toggleDifficultCardHard(card)}
                      title={card.phrase_difficulty === "hard" ? "Remove hard mark" : "Mark as hard"}
                      aria-label={card.phrase_difficulty === "hard" ? "Remove hard mark" : "Mark as hard"}
                    >
                      <Flag />
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="hidden bg-red-600 text-white hover:bg-red-500 sm:inline-flex"
                      onClick={() => void archiveFlashcard(card.flashcard_id)}
                      title="Remove from Flashcards"
                      aria-label="Remove from Flashcards"
                    >
                      <ArchiveX />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <div className="mt-10 grid gap-6 sm:grid-cols-4">
        <Metric label="Due now" value={overview?.due_reviews ?? 0} />
        <Metric label="Overdue" value={overview?.overdue_reviews ?? 0} />
        <Metric label="New phrases" value={overview?.new_phrases ?? 0} />
        <Metric label="Active flashcards" value={overview?.active_flashcards ?? 0} />
      </div>
      <div className="mt-10 flex flex-wrap gap-2">
        <Button onClick={() => void start()} disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Play />}Start session
        </Button>
        {overview?.can_add_new_phrases && (
          <Button variant="secondary" onClick={() => void start(true)} disabled={busy}>
            <Plus />
            Add {overview.settings.new_phrases_per_batch} new phrases
          </Button>
        )}
      </div>
      <StoryModal
        open={storyOpen}
        phraseIds={storyPhraseIds}
        onClose={() => {
          setStoryOpen(false);
          setStoryPhraseIds([]);
        }}
      />
      <PhraseLearningHintModal
        open={Boolean(editingDifficultHint)}
        phraseLabel={editingDifficultHint ? `${editingDifficultHint.en_text} / ${editingDifficultHint.pl_text}` : ""}
        initialValue={editingDifficultHint?.learning_hint_markdown ?? null}
        imageUrl={editingDifficultHint?.image_url}
        onSaveImage={(url) => {
          if (editingDifficultHint) void saveImage(url, editingDifficultHint.phrase_id);
        }}
        isSaving={isSavingHint}
        error={hintSaveError}
        onSave={saveDifficultLearningHint}
        onClose={() => {
          if (!isSavingHint) setEditingDifficultHint(null);
        }}
      />
    </section>
  );
}
function ratingButtonClass(rating: Rating): string {
  return {
    Again: "bg-red-600 text-white hover:bg-red-500",
    Hard: "bg-amber-400 text-black hover:bg-amber-300",
    Good: "bg-emerald-500 text-black hover:bg-emerald-400",
    Easy: "bg-sky-400 text-black hover:bg-sky-300",
  }[rating];
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-b border-border pb-4">
      <p className="text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
export default function FlashcardsView(props: FlashcardsViewProps) {
  return (
    <ToastProvider>
      <FlashcardsContent {...props} />
    </ToastProvider>
  );
}
