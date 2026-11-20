import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { GET } from "../pages/api/flashcards/difficult";
import { getSupabaseClient } from "../lib/utils";

vi.mock("../lib/utils", () => ({ getSupabaseClient: vi.fn() }));

function review(phraseId: string, rating: string, reviewedAt: string, direction = "en_to_pl") {
  return {
    phrase_id: phraseId,
    flashcard_id: `card-${phraseId}`,
    flashcard_direction_id: `${phraseId}-${direction}`,
    direction,
    fsrs_rating: rating,
    reviewed_at: reviewedAt,
    user_id: "user-1",
    flashcards: {
      id: `card-${phraseId}`,
      status: "active",
      phrases: {
        en_text: phraseId,
        pl_text: phraseId,
        difficulty: null,
        learning_hint_markdown: null,
        image_url: "https://example.com/photo.jpg",
      },
    },
  };
}

function mockDatabase(reviews: ReturnType<typeof review>[]) {
  const ratingFilter = vi.fn();
  const ordering = vi.fn();
  vi.mocked(getSupabaseClient).mockReturnValue({
    from: (table: string) => {
      let rows = table === "flashcard_reviews" ? [...reviews] : [];
      const query = {
        select: () => query,
        eq: (key: string, value: string) => {
          if (key === "user_id") rows = rows.filter((row) => row.user_id === value);
          if (key === "flashcards.status") rows = rows.filter((row) => row.flashcards.status === value);
          return query;
        },
        in: (key: string, values: string[]) => {
          if (key === "fsrs_rating") {
            ratingFilter(values);
            rows = rows.filter((row) => values.includes(row.fsrs_rating));
          }
          return query;
        },
        gte: (_key: string, value: string) => {
          rows = rows.filter((row) => row.reviewed_at >= value);
          return query;
        },
        order: (key: string, options: { ascending: boolean }) => {
          ordering(key, options);
          rows.sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at));
          return query;
        },
        limit: async (limit: number) => ({ data: rows.slice(0, limit), error: null }),
        maybeSingle: async () => ({ data: { difficult_cards_per_training: 3 }, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
      };
      return query;
    },
  } as unknown as ReturnType<typeof getSupabaseClient>);
  return { ratingFilter, ordering };
}

function context(pool: string, limit = "", userId: string | null = "user-1") {
  return {
    locals: { userId },
    request: new Request(`https://example.com/api/flashcards/difficult?pool=${pool}${limit ? `&limit=${limit}` : ""}`),
  } as APIContext;
}

describe("recent difficult flashcards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("mixes Again and Hard by most recent mistake before deduplicating phrases and applying the limit", async () => {
    const { ratingFilter, ordering } = mockDatabase([
      review("older-again", "Again", "2026-11-10T10:00:00Z"),
      review("latest-hard", "Again", "2026-11-11T10:00:00Z"),
      review("middle-again", "Again", "2026-11-13T10:00:00Z"),
      review("latest-hard", "Hard", "2026-11-14T10:00:00Z", "pl_to_en"),
      review("latest-good", "Good", "2026-11-15T10:00:00Z"),
      review("latest-easy", "Easy", "2026-11-15T11:00:00Z"),
      review("outside-window", "Hard", "2026-01-01T10:00:00Z"),
      { ...review("other-user", "Hard", "2026-11-15T10:00:00Z"), user_id: "user-2" },
      {
        ...review("suspended", "Again", "2026-11-15T10:00:00Z"),
        flashcards: { ...review("suspended", "Again", "").flashcards, status: "suspended" },
      },
    ]);
    const response = await GET(context("recent_again_or_hard", "2"));
    expect(response.status).toBe(200);
    const { items } = await response.json();
    expect(items.map((item: { phrase_id: string }) => item.phrase_id)).toEqual(["latest-hard", "middle-again"]);
    expect(items[0]).toMatchObject({
      direction: "pl_to_en",
      recent_again_or_hard: 2,
      image_url: "https://example.com/photo.jpg",
    });
    expect(ratingFilter).toHaveBeenCalledWith(["Again", "Hard"]);
    expect(ordering).toHaveBeenCalledWith("reviewed_at", { ascending: false });
  });

  it("preserves the Again-only option", async () => {
    const { ratingFilter } = mockDatabase([
      review("hard", "Hard", "2026-11-15T10:00:00Z"),
      review("again", "Again", "2026-11-14T10:00:00Z"),
    ]);
    const response = await GET(context("recent_again"));
    const { items } = await response.json();
    expect(items.map((item: { phrase_id: string }) => item.phrase_id)).toEqual(["again"]);
    expect(ratingFilter).toHaveBeenCalledWith(["Again"]);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await GET(context("recent_again_or_hard", "", null))).status).toBe(401);
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });
});
