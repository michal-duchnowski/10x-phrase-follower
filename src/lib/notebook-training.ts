import type { LearnManifestDTO } from "../types";

export interface TrainingCard {
  direction_id: string;
  phrase_id: string;
  direction: "en_to_pl" | "pl_to_en";
  prompt_text: string;
  expected_answer: string;
  en_text: string;
  pl_text: string;
  learning_hint_markdown: string | null;
}

/** Both directions enter one shuffled queue, without creating saved flashcards. */
export function createNotebookTrainingCards(phrases: LearnManifestDTO["phrases"]): TrainingCard[] {
  const cards = phrases.flatMap((phrase) =>
    (["en_to_pl", "pl_to_en"] as const).map((direction) => ({
      direction_id: `${phrase.id}:${direction}`,
      phrase_id: phrase.id,
      direction,
      prompt_text: direction === "en_to_pl" ? phrase.en_text : phrase.pl_text,
      expected_answer: direction === "en_to_pl" ? phrase.pl_text : phrase.en_text,
      en_text: phrase.en_text,
      pl_text: phrase.pl_text,
      learning_hint_markdown: phrase.learning_hint_markdown,
    }))
  );
  for (let index = cards.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [cards[index], cards[randomIndex]] = [cards[randomIndex], cards[index]];
  }
  return cards;
}
