import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearnPhraseDTO } from "../types";
import { createNotebookTrainingCards } from "./notebook-training";

const phrases: LearnPhraseDTO[] = [
  {
    id: "phrase-one",
    position: 1,
    en_text: "cat",
    pl_text: "kot",
    learning_hint_markdown: "A hint",
    tokens: null,
    difficulty: null,
    audio: { has_en_audio: false, has_pl_audio: false },
  },
  {
    id: "phrase-two",
    position: 2,
    en_text: "dog",
    pl_text: "pies",
    learning_hint_markdown: null,
    tokens: null,
    difficulty: "hard",
    audio: { has_en_audio: true, has_pl_audio: false },
  },
];

afterEach(() => vi.restoreAllMocks());

describe("notebook training", () => {
  it("includes each selected phrase in both directions even without audio or saved flashcards", () => {
    const cards = createNotebookTrainingCards(phrases.slice(0, 1));
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((card) => card.direction_id)).size).toBe(2);
    expect(cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phrase_id: "phrase-one",
          direction: "en_to_pl",
          prompt_text: "cat",
          expected_answer: "kot",
          learning_hint_markdown: "A hint",
        }),
        expect.objectContaining({
          phrase_id: "phrase-one",
          direction: "pl_to_en",
          prompt_text: "kot",
          expected_answer: "cat",
          learning_hint_markdown: "A hint",
        }),
      ])
    );
  });

  it("shuffles both directions together at the start without changing the notebook phrases", () => {
    const original = structuredClone(phrases);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const cards = createNotebookTrainingCards(phrases);
    expect(cards.map((card) => `${card.phrase_id}:${card.direction}`)).toEqual([
      "phrase-one:pl_to_en",
      "phrase-two:en_to_pl",
      "phrase-two:pl_to_en",
      "phrase-one:en_to_pl",
    ]);
    expect(phrases).toEqual(original);
  });

  it("returns no cards for an empty selection", () => {
    expect(createNotebookTrainingCards([])).toEqual([]);
  });
});
