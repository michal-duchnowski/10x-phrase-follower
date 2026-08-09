import { useEffect, useRef, useState } from "react";
import {
  ArchiveX,
  CheckCircle2,
  CircleHelp,
  Flame,
  LoaderCircle,
  Play,
  Settings2,
  Volume2,
  XCircle,
} from "lucide-react";
import { Button } from "./ui/button";
import { ToastProvider, useToast } from "./ui/toast";
import { useApi } from "../lib/hooks/useApi";
import PhraseLearningHintModal from "./PhraseLearningHintModal";
import { parseMarkdownToHtml } from "../lib/utils";

interface SessionCard {
  direction_id: string;
  phrase_id: string;
  direction: "en_to_pl" | "pl_to_en";
  prompt_text: string;
  expected_answer: string;
  en_text: string;
  pl_text: string;
  learning_hint_markdown: string | null;
}
interface Overview {
  due_reviews: number;
  overdue_reviews: number;
  new_phrases: number;
  settings: { new_phrases_per_batch: number; review_cards_per_batch: number };
}
type Rating = "Again" | "Hard" | "Good" | "Easy";
interface DifficultCard {
  flashcard_id: string;
  direction_id: string;
  direction: "en_to_pl" | "pl_to_en";
  en_text: string;
  pl_text: string;
  score: number;
  lapses: number;
  stability: number;
  state: string;
  recent_again_or_hard: number;
}

function FlashcardsContent() {
  const { apiCall, isAuthenticated } = useApi();
  const { addToast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [cards, setCards] = useState<SessionCard[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState<{ kind: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isSavingHint, setIsSavingHint] = useState(false);
  const [hintSaveError, setHintSaveError] = useState<string | null>(null);
  const [difficultOpen, setDifficultOpen] = useState(false);
  const [difficultCards, setDifficultCards] = useState<DifficultCard[]>([]);
  const [difficultLoading, setDifficultLoading] = useState(false);
  const current = cards[index];
  const loadOverview = async () => {
    try {
      setOverview(await apiCall<Overview>("/api/flashcards/overview"));
    } catch {
      /* AuthGuard presents authentication state. */
    }
  };
  const loadDifficultCards = async () => {
    setDifficultLoading(true);
    try {
      const data = await apiCall<{ items: DifficultCard[] }>("/api/flashcards/difficult");
      setDifficultCards(data.items);
      setDifficultOpen(true);
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
  useEffect(() => {
    if (isAuthenticated) void loadOverview();
  }, [isAuthenticated]);
  useEffect(() => () => audioRef.current?.pause(), []);
  useEffect(() => {
    if (!current || checked || detailsOpen) return;
    const frame = window.requestAnimationFrame(() => answerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [current?.direction_id, checked, detailsOpen]);
  useEffect(() => {
    const handleRatingShortcut = (event: KeyboardEvent) => {
      if (!checked || busy || detailsOpen) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      const rating = ({ "1": "Again", "2": "Hard", "3": "Good", "4": "Easy" } as const)[event.key];
      if (!rating) return;
      event.preventDefault();
      void rate(rating);
    };
    window.addEventListener("keydown", handleRatingShortcut);
    return () => window.removeEventListener("keydown", handleRatingShortcut);
  }, [checked, busy, detailsOpen, current]);
  const start = async () => {
    setBusy(true);
    try {
      const data = await apiCall<{ cards: SessionCard[] }>("/api/flashcards/session", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setCards(data.cards);
      setIndex(0);
      setAnswer("");
      setChecked(null);
      setDetailsOpen(false);
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
  const playEnglish = async () => {
    if (!current) return;
    try {
      const { url } = await apiCall<{ url: string | null }>(
        `/api/flashcards/audio?phrase_id=${encodeURIComponent(current.phrase_id)}`
      );
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
  const check = () => {
    if (!answer.trim() || !current) return;
    const expected = current.expected_answer.toLocaleLowerCase().trim();
    const typed = answer.toLocaleLowerCase().trim();
    setChecked({ kind: typed === expected ? "exact" : expected.includes(typed) ? "contains" : "manual" });
    void playEnglish();
  };
  const rate = (rating: Rating) => {
    if (!current || !checked) return;
    const review = { flashcard_direction_id: current.direction_id, user_answer: answer, fsrs_rating: rating };
    const completedSession = index + 1 >= cards.length;
    setIndex((value) => value + 1);
    setAnswer("");
    setChecked(null);
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
        }),
      });
      setSettingsOpen(false);
      await loadOverview();
    } finally {
      setBusy(false);
    }
  };
  if (cards.length && !current)
    return (
      <section className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-semibold">Daily session completed</h1>
        <p className="mt-2 text-muted-foreground">Your reviews have been saved.</p>
        <Button className="mt-6" onClick={start}>
          Learn more
        </Button>
      </section>
    );
  if (current) {
    const isMatch = checked?.kind === "exact" || checked?.kind === "contains";
    return (
      <section className="mx-auto max-w-2xl py-5">
        <div className="mb-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>{cards.length - index} cards remaining</span>
          <div className="flex items-center gap-2">
            <span>{current.direction === "en_to_pl" ? "English to Polish" : "Polish to English"}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-foreground hover:bg-muted"
              onClick={() => {
                setHintSaveError(null);
                setDetailsOpen(true);
              }}
              title="Learning hint"
            >
              <CircleHelp />
            </Button>
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-5 py-5 shadow-sm sm:px-6">
          <div
            className="text-xl leading-7 text-foreground sm:text-2xl sm:leading-8"
            dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(current.prompt_text) }}
          />
        </div>
        <label htmlFor="flashcard-answer" className="mt-4 block text-sm font-medium text-foreground">
          Your answer
        </label>
        <textarea
          id="flashcard-answer"
          ref={answerRef}
          value={answer}
          disabled={Boolean(checked) || busy}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              check();
            }
          }}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="Type your answer"
          className="mt-2 min-h-[72px] w-full rounded-md border border-input bg-card p-3 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {!checked ? (
          <Button
            className="mt-3 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={check}
            disabled={!answer.trim() || busy}
          >
            Check answer
          </Button>
        ) : (
          <div className="mt-4 space-y-3 rounded-md border border-border bg-card p-4 shadow-sm">
            <div
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${isMatch ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-destructive/40 bg-destructive/10 text-destructive"}`}
            >
              {isMatch ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
              {isMatch ? (checked.kind === "exact" ? "Correct" : "Partial match") : "Not correct"}
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">Expected answer</p>
                <div
                  className="mt-1 text-lg text-foreground"
                  dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(current.expected_answer) }}
                />
              </div>
              <Button variant="secondary" size="icon" onClick={() => void playEnglish()} title="Play English audio">
                <Volume2 />
              </Button>
            </div>
            {!isMatch && <p className="text-sm text-muted-foreground">Choose the rating that reflects your recall.</p>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["Again", "Hard", "Good", "Easy"] as const).map((rating) => (
                <Button key={rating} className={ratingButtonClass(rating)} onClick={() => rate(rating)}>
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
          >
            {difficultLoading ? <LoaderCircle className="animate-spin" /> : <Flame />}
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="bg-sky-400 text-black hover:bg-sky-300"
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Flashcard settings"
          >
            <Settings2 />
          </Button>
        </div>
      </div>
      {settingsOpen && overview && (
        <form
          onSubmit={saveSettings}
          className="mt-6 grid grid-cols-2 gap-4 rounded-md border border-border bg-card p-4 shadow-sm"
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
          <Button type="submit" disabled={busy} className="col-span-2 bg-primary text-primary-foreground">
            Save settings
          </Button>
        </form>
      )}
      {difficultOpen && (
        <section className="mt-6 border-y border-border py-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Most difficult</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Top 20 based on FSRS difficulty, stability, lapses, overdue time and recent ratings.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDifficultOpen(false)}>
              Close
            </Button>
          </div>
          {difficultCards.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">No difficult flashcards yet.</p>
          ) : (
            <div className="mt-5 divide-y divide-border">
              {difficultCards.map((card) => (
                <div key={card.direction_id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {card.direction === "en_to_pl" ? card.en_text : card.pl_text}
                    </p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {card.direction === "en_to_pl" ? card.pl_text : card.en_text}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Score {card.score} · {card.lapses} lapses · stability {card.stability}d ·{" "}
                      {card.recent_again_or_hard} recent Again/Hard
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="shrink-0 bg-red-600 text-white hover:bg-red-500"
                    onClick={() => void archiveFlashcard(card.flashcard_id)}
                    title="Remove from Flashcards"
                  >
                    <ArchiveX />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <div className="mt-10 grid gap-6 sm:grid-cols-3">
        <Metric label="Due now" value={overview?.due_reviews ?? 0} />
        <Metric label="Overdue" value={overview?.overdue_reviews ?? 0} />
        <Metric label="New phrases" value={overview?.new_phrases ?? 0} />
      </div>
      <Button className="mt-10" onClick={start} disabled={busy}>
        {busy ? <LoaderCircle className="animate-spin" /> : <Play />}Start session
      </Button>
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
export default function FlashcardsView() {
  return (
    <ToastProvider>
      <FlashcardsContent />
    </ToastProvider>
  );
}
