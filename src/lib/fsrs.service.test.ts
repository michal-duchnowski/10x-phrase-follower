import { describe, expect, it } from "vitest";
import { checkFlashcardAnswer, scheduleReview } from "./fsrs.service";

describe("flashcard answer checking", () => {
  it("identifies exact, partial, typo, and incorrect answers", () => {
    expect(checkFlashcardAnswer("Dzien dobry", "Dzień dobry").kind).toBe("exact");
    expect(checkFlashcardAnswer("HELLO", "hello").kind).toBe("exact");
    expect(checkFlashcardAnswer("good", "good morning, good day").kind).toBe("contains");
    expect(checkFlashcardAnswer("colour", "color").kind).toBe("typo");
    expect(checkFlashcardAnswer("no", "yes").kind).toBe("incorrect");
  });
});

describe("FSRS scheduling", () => {
  it("returns a next card after an explicit rating", () => {
    const result = scheduleReview(
      {
        due_at: "2026-01-01T00:00:00.000Z",
        stability: 0,
        difficulty: 0,
        scheduled_days: 0,
        elapsed_days: 0,
        learning_steps: 0,
        reps: 0,
        lapses: 0,
        fsrs_state: "New",
        last_review_at: null,
      },
      "Good",
      new Date("2026-01-01T00:00:00.000Z")
    );
    expect(result.next.reps).toBe(1);
    expect(result.next.due).toBeInstanceOf(Date);
  });
});
