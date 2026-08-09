import { createEmptyCard, fsrs, Rating, State, type Card } from "ts-fsrs";

export type FlashcardDirection = "en_to_pl" | "pl_to_en";
export type FsrsRating = "Again" | "Hard" | "Good" | "Easy";
export type AnswerMatchKind = "exact" | "contains" | "typo" | "incorrect" | "manual";

export interface StoredFsrsCard {
  due_at: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  elapsed_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  fsrs_state: "New" | "Learning" | "Review" | "Relearning";
  last_review_at: string | null;
}

const stateByName = {
  New: State.New,
  Learning: State.Learning,
  Review: State.Review,
  Relearning: State.Relearning,
} as const;
const nameByState = ["New", "Learning", "Review", "Relearning"] as const;
const ratingByName = { Again: Rating.Again, Hard: Rating.Hard, Good: Rating.Good, Easy: Rating.Easy } as const;

export function toFsrsCard(row: StoredFsrsCard): Card {
  const empty = createEmptyCard(new Date(row.due_at));
  return {
    ...empty,
    due: new Date(row.due_at),
    stability: row.stability,
    difficulty: row.difficulty,
    scheduled_days: row.scheduled_days,
    elapsed_days: row.elapsed_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: stateByName[row.fsrs_state],
    last_review: row.last_review_at ? new Date(row.last_review_at) : undefined,
  };
}

export function serializeCard(card: Card): StoredFsrsCard {
  return {
    due_at: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduled_days,
    elapsed_days: card.elapsed_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    fsrs_state: nameByState[card.state],
    last_review_at: card.last_review?.toISOString() ?? null,
  };
}

export function scheduleReview(card: StoredFsrsCard, rating: FsrsRating, reviewedAt = new Date(), retention = 0.9) {
  const scheduler = fsrs({
    request_retention: retention,
    maximum_interval: 36500,
    enable_fuzz: true,
    enable_short_term: true,
    learning_steps: ["1m", "10m"],
    relearning_steps: ["10m"],
  });
  const previous = toFsrsCard(card);
  const result = scheduler.next(previous, reviewedAt, ratingByName[rating]);
  return { previous, next: result.card, log: result.log };
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]++;
    for (let j = 1; j <= b.length; j++) {
      const value = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = value;
    }
  }
  return row[b.length];
}

export function checkFlashcardAnswer(
  userAnswer: string,
  expectedAnswer: string
): { kind: AnswerMatchKind; normalizedUser: string; normalizedExpected: string } {
  const normalize = (text: string) =>
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF*_]/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const normalizedUser = normalize(userAnswer);
  const normalizedExpected = normalize(expectedAnswer);
  if (normalizedUser === normalizedExpected) return { kind: "exact", normalizedUser, normalizedExpected };
  const parts = normalizedExpected.split(/\s*(?:\/|;|,|\bor\b)\s*/).filter(Boolean);
  const expectedWords = normalizedExpected.split(" ").filter((word) => word.length > 2);
  if (
    parts.some((part) => normalizedUser === part || (part.length > 2 && normalizedUser.includes(part))) ||
    expectedWords.includes(normalizedUser)
  )
    return { kind: "contains", normalizedUser, normalizedExpected };
  const distance = levenshtein(normalizedUser, normalizedExpected);
  if (normalizedUser && distance <= Math.max(1, Math.floor(normalizedExpected.length * 0.12)))
    return { kind: "typo", normalizedUser, normalizedExpected };
  return { kind: "incorrect", normalizedUser, normalizedExpected };
}
