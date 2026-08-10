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

export function getFlashcardsDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
