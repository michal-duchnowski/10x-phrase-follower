import type { FlashcardDirection } from "./fsrs.service";

export interface FlashcardSessionCard {
  direction_id: string;
  flashcard_id: string;
  phrase_id: string;
  direction: FlashcardDirection;
  prompt_text: string;
  expected_answer: string;
  fsrs_card: Record<string, unknown>;
}

export function spaceDirections<T extends { phrase_id: string }>(cards: T[]): T[] {
  const result: T[] = [];
  const deferred: T[] = [];
  for (const card of cards) {
    if (result.slice(-3).some((item) => item.phrase_id === card.phrase_id)) deferred.push(card);
    else result.push(card);
  }
  return [...result, ...deferred];
}
