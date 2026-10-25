import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { GET } from "../pages/api/flashcards/export";
import { getSupabaseClient } from "../lib/utils";

vi.mock("../lib/utils", () => ({ getSupabaseClient: vi.fn() }));

const direction = (id: string, status = "active", lapses = 0) => ({
  id,
  direction: "pl_to_en",
  fsrs_state: "Review",
  stability: 8,
  difficulty: 4,
  reps: 5,
  lapses,
  due_at: "2026-10-25T10:00:00Z",
  last_review_at: "2026-10-24T10:00:00Z",
  flashcards: { status, phrases: { en_text: `English ${id}`, pl_text: `Polish ${id}` } },
});

function context(query = "", userId: string | null = "user-1") {
  return { url: new URL(`https://example.com/api/flashcards/export${query}`), locals: { userId } } as APIContext;
}

describe("flashcard Markdown export API", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
  });

  function mockDatabase(
    directions = [
      direction("again"),
      direction("hard"),
      direction("good"),
      direction("new"),
      direction("archived", "archived", 20),
    ],
    reviews = [
      { flashcard_direction_id: "again", fsrs_rating: "Again", reviewed_at: "2026-10-24T10:00:00Z" },
      { flashcard_direction_id: "hard", fsrs_rating: "Hard", reviewed_at: "2026-10-24T10:00:00Z" },
      { flashcard_direction_id: "good", fsrs_rating: "Good", reviewed_at: "2026-10-24T10:00:00Z" },
      { flashcard_direction_id: "archived", fsrs_rating: "Again", reviewed_at: "2026-10-24T10:00:00Z" },
    ]
  ) {
    const filters = vi.fn();
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: (table: string) => {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn((...args: unknown[]) => {
            filters(...args);
            return query;
          }),
          order: vi.fn(() => query),
          range: vi.fn(async (from: number, to: number) => ({
            data: (table === "flashcard_directions" ? directions : reviews).slice(from, to + 1),
            error: null,
          })),
        };
        return query;
      },
    } as unknown as ReturnType<typeof getSupabaseClient>);
    return filters;
  }

  it("preserves the full export and scopes both queries to the current user", async () => {
    const filters = mockDatabase();
    const response = await GET(context());
    const markdown = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Flashcard-Count")).toBe("5");
    expect(markdown).toContain("Następna powtórka | Status |");
    expect(markdown).toContain("English archived");
    expect(filters).toHaveBeenCalledWith("flashcards.user_id", "user-1");
    expect(filters).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("includes only active Again/Hard directions with exactly seven columns", async () => {
    mockDatabase();
    const response = await GET(context("?mode=difficult"));
    const markdown = await response.text();
    expect(response.headers.get("X-Flashcard-Count")).toBe("2");
    expect(markdown).toContain("| Front | Back | Kierunek | Score | Powtórki | Błędy | Stabilność |");
    expect(markdown).toContain("English again");
    expect(markdown).toContain("English hard");
    expect(markdown).not.toMatch(/English (good|new|archived)/);
    expect(markdown).not.toContain("Następna powtórka");
  });

  it("limits the highest scoring directions after filtering", async () => {
    mockDatabase();
    const response = await GET(context("?mode=difficult&limit=1"));
    const markdown = await response.text();
    expect(response.headers.get("X-Flashcard-Count")).toBe("1");
    expect(markdown).toContain("English again");
    expect(markdown).not.toContain("English hard");
  });

  it.each(["pl_to_en", "en_to_pl"])("filters direction %s before applying the limit", async (selectedDirection) => {
    mockDatabase([direction("again"), { ...direction("hard"), direction: "en_to_pl" }]);
    const response = await GET(context(`?mode=difficult&direction=${selectedDirection}&limit=1`));
    const markdown = await response.text();
    expect(response.headers.get("X-Flashcard-Count")).toBe("1");
    expect(markdown).toContain(selectedDirection === "pl_to_en" ? "English again" : "English hard");
    expect(markdown).not.toContain(selectedDirection === "pl_to_en" ? "English hard" : "English again");
  });

  it.each([7, 30])(
    "includes Again/Hard exactly at the %s-day boundary, but excludes older problems and recent Good reviews",
    async (days) => {
      const cutoff = Date.now() - days * 86400000;
      mockDatabase(
        [direction("boundary"), direction("old"), direction("good"), direction("future")],
        [
          { flashcard_direction_id: "boundary", fsrs_rating: "Hard", reviewed_at: new Date(cutoff).toISOString() },
          { flashcard_direction_id: "boundary", fsrs_rating: "Good", reviewed_at: new Date().toISOString() },
          { flashcard_direction_id: "old", fsrs_rating: "Again", reviewed_at: new Date(cutoff - 1).toISOString() },
          { flashcard_direction_id: "old", fsrs_rating: "Good", reviewed_at: new Date().toISOString() },
          { flashcard_direction_id: "good", fsrs_rating: "Good", reviewed_at: new Date().toISOString() },
          {
            flashcard_direction_id: "future",
            fsrs_rating: "Again",
            reviewed_at: new Date(Date.now() + 1).toISOString(),
          },
        ]
      );
      const response = await GET(context(`?mode=difficult&period=${days}`));
      const markdown = await response.text();
      expect(response.headers.get("X-Flashcard-Count")).toBe("1");
      expect(markdown).toContain("English boundary");
      expect(markdown).not.toMatch(/English (old|good|future)/);
    }
  );

  it("combines direction and period filters", async () => {
    mockDatabase(
      [direction("old"), direction("recent"), { ...direction("opposite"), direction: "en_to_pl" }],
      [
        { flashcard_direction_id: "old", fsrs_rating: "Again", reviewed_at: "2026-10-10T10:00:00Z" },
        { flashcard_direction_id: "recent", fsrs_rating: "Hard", reviewed_at: "2026-10-24T10:00:00Z" },
        { flashcard_direction_id: "opposite", fsrs_rating: "Again", reviewed_at: "2026-10-24T10:00:00Z" },
      ]
    );
    const response = await GET(context("?mode=difficult&direction=pl_to_en&period=7&limit=1"));
    expect(response.headers.get("X-Flashcard-Count")).toBe("1");
    expect(await response.text()).toContain("English recent");
    const allHistory = await GET(context("?mode=difficult&direction=pl_to_en&period=all"));
    expect(allHistory.headers.get("X-Flashcard-Count")).toBe("2");
  });

  it.each(["direction=invalid", "period=0", "period=14", "period=-7", "period="])(
    "rejects invalid filter %s",
    async (filter) => {
      const response = await GET(context(`?mode=difficult&${filter}`));
      expect(response.status).toBe(400);
      expect(getSupabaseClient).not.toHaveBeenCalled();
    }
  );

  it("keeps the full export independent of difficult-card filters", async () => {
    mockDatabase();
    const response = await GET(context("?mode=all&direction=en_to_pl&period=7&limit=1"));
    expect(response.headers.get("X-Flashcard-Count")).toBe("5");
  });

  it("defaults to 20 directions and paginates beyond the database page size", async () => {
    const directions = Array.from({ length: 1001 }, (_, index) => direction(`new-${index}`));
    directions.push(...Array.from({ length: 25 }, () => direction("again")));
    mockDatabase(directions);
    const response = await GET(context("?mode=difficult"));
    expect(response.headers.get("X-Flashcard-Count")).toBe("20");
  });

  it("returns an empty export when no cards match", async () => {
    mockDatabase([]);
    const response = await GET(context("?mode=difficult"));
    expect(response.headers.get("X-Flashcard-Count")).toBe("0");
    expect(await response.text()).toContain("Liczba fiszek (kierunków): 0");
  });

  it.each(["0", "-1", "1.5", "1001", "NaN", "", "2e1"])("rejects invalid limit %s", async (limit) => {
    const response = await GET(context(`?mode=difficult&limit=${limit}`));
    expect(response.status).toBe(400);
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  it("rejects unknown modes and unauthenticated requests", async () => {
    expect((await GET(context("?mode=unknown"))).status).toBe(400);
    expect((await GET(context("", null))).status).toBe(401);
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });
});
