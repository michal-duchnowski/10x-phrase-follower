import { describe, expect, it } from "vitest";
import { buildFlashcardsMarkdown } from "./flashcards-export";

describe("buildFlashcardsMarkdown", () => {
  it("writes escaped card data in descending score order", () => {
    const result = buildFlashcardsMarkdown(
      [
        {
          direction: "en_to_pl",
          enText: "tea | coffee",
          plText: "herbata\nkawa",
          score: 2,
          state: "Review",
          reps: 3,
          lapses: 0,
          stability: 8.25,
          lastReviewAt: null,
          dueAt: "2026-09-13T10:00:00.000Z",
          status: "active",
        },
        {
          direction: "pl_to_en",
          enText: "water",
          plText: "woda",
          score: 12,
          state: "Learning",
          reps: 1,
          lapses: 1,
          stability: 2,
          lastReviewAt: "2026-09-12T10:00:00.000Z",
          dueAt: "2026-09-13T10:00:00.000Z",
          status: "active",
        },
      ],
      new Date("2026-09-13T12:00:00.000Z")
    );

    expect(result).toContain("| woda | water | PL → EN | 12 |");
    expect(result.indexOf("| woda")).toBeLessThan(result.indexOf("tea \\| coffee"));
    expect(result).toContain("tea \\| coffee | herbata<br>kawa");
    expect(result).toContain("| — | 2026-09-13 10:00:00 UTC |");
  });
});
