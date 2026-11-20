import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { GET } from "../pages/api/flashcards/overview";
import { POST } from "../pages/api/flashcards/session";
import { getSupabaseClient } from "../lib/utils";

vi.mock("../lib/utils", () => ({ getSupabaseClient: vi.fn() }));

function direction(index: number, state = "New", dueAt = "2026-11-04T20:29:33Z") {
  return {
    id: `direction-${index}`,
    flashcard_id: `flashcard-${Math.floor(index / 2)}`,
    direction: index % 2 === 0 ? "en_to_pl" : "pl_to_en",
    fsrs_state: state,
    reps: state === "New" ? 0 : 1,
    due_at: dueAt,
    flashcards: {
      id: `flashcard-${Math.floor(index / 2)}`,
      phrase_id: `phrase-${Math.floor(index / 2)}`,
      phrases: {
        en_text: `English ${index}`,
        pl_text: `Polish ${index}`,
        learning_hint_markdown: null,
        image_url: "https://example.com/photo.jpg",
      },
    },
  };
}

function context(body = {}, userId: string | null = "user-1") {
  return {
    locals: { userId },
    request: new Request("https://example.com/api/flashcards/session", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  } as APIContext;
}

function mockDatabase(
  directions: ReturnType<typeof direction>[],
  introductions: { phrase_id: string; introduced_on: string }[] = [],
  failingTable = "",
  failingOffset = 1000
) {
  const insert = vi.fn(async () => ({ error: null }));
  const range = vi.fn();
  const filters = vi.fn();
  const orders = vi.fn();
  vi.mocked(getSupabaseClient).mockReturnValue({
    from: (table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((...args: unknown[]) => {
          filters(table, ...args);
          return query;
        }),
        order: vi.fn((...args: unknown[]) => {
          orders(table, ...args);
          return query;
        }),
        range: vi.fn(async (from: number, to: number) => {
          range(table, from, to);
          if (table === failingTable && from === failingOffset) return { data: null, error: new Error("DB error") };
          return {
            data: (table === "flashcard_directions" ? directions : introductions).slice(from, to + 1),
            error: null,
          };
        }),
        maybeSingle: vi.fn(async () => ({
          data: { new_phrases_per_batch: 5, review_cards_per_batch: 50 },
          error: null,
        })),
        insert,
      };
      return query;
    },
  } as unknown as ReturnType<typeof getSupabaseClient>);
  return { insert, range, filters, orders };
}

describe("flashcard overview and session pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  // Old cards fill the first DB page; untouched cards exist only on the next one.
  function largeDeck() {
    return [
      ...Array.from({ length: 1000 }, (_, index) => direction(index, "Review", "2026-12-01T12:00:00Z")),
      ...Array.from({ length: 34 }, (_, index) => direction(1000 + index)),
    ];
  }

  it("counts new phrases and active flashcards beyond the first 1000 directions", async () => {
    const { range, filters, orders } = mockDatabase(largeDeck());
    const response = await GET(context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ new_phrases: 17, active_flashcards: 517, due_reviews: 0 });
    expect(range).toHaveBeenCalledWith("flashcard_directions", 1000, 1999);
    expect(filters).toHaveBeenCalledWith("flashcard_directions", "flashcards.user_id", "user-1");
    expect(filters).toHaveBeenCalledWith("flashcard_directions", "flashcards.status", "active");
    expect(orders).toHaveBeenCalledWith("flashcard_directions", "id");
  });

  it("includes new cards beyond the first page in the session, respecting the phrase batch size", async () => {
    const { insert, orders } = mockDatabase(largeDeck());
    const response = await POST(context());
    expect(response.status).toBe(200);
    const { cards } = await response.json();
    expect(cards).toHaveLength(10);
    expect(new Set(cards.map((card: { phrase_id: string }) => card.phrase_id)).size).toBe(5);
    expect(cards[0].direction_id).toBe("direction-1000");
    expect(cards.every((card: { image_url: string }) => card.image_url === "https://example.com/photo.jpg")).toBe(true);
    expect(insert).toHaveBeenCalledOnce();
    expect(orders).toHaveBeenCalledWith("flashcard_directions", "due_at");
    expect(orders).toHaveBeenCalledWith("flashcard_directions", "id");
  });

  it("counts due and overdue reviews on subsequent pages", async () => {
    mockDatabase([
      ...largeDeck().slice(0, 1000),
      direction(1000, "Review", "2026-11-03T12:00:00Z"),
      direction(1001, "Learning", "2026-11-05T11:00:00Z"),
    ]);
    const response = await GET(context());
    expect(await response.json()).toMatchObject({ due_reviews: 2, overdue_reviews: 1 });
    const session = await POST(context());
    expect((await session.json()).cards).toHaveLength(2);
  });

  it("loads all introduction records and resumes untouched cards introduced today", async () => {
    const introductions = [
      ...Array.from({ length: 1000 }, (_, index) => ({ phrase_id: `old-${index}`, introduced_on: "2026-11-01" })),
      { phrase_id: "phrase-0", introduced_on: "2026-11-05" },
    ];
    const { insert, range } = mockDatabase([direction(0), direction(1)], introductions);
    const overview = await GET(context());
    expect(await overview.json()).toMatchObject({ new_phrases_today: 1, new_phrases: 1 });
    const response = await POST(context());
    expect((await response.json()).cards).toHaveLength(2);
    expect(insert).not.toHaveBeenCalled();
    expect(range).toHaveBeenCalledWith("flashcard_phrase_introductions", 1000, 1999);
  });

  it("excludes completed directions when resuming a new phrase", async () => {
    mockDatabase([direction(0), direction(1)], [{ phrase_id: "phrase-0", introduced_on: "2026-11-05" }]);
    const response = await POST(context({ completed_direction_ids: ["direction-0"] }));
    expect((await response.json()).cards.map((card: { direction_id: string }) => card.direction_id)).toEqual([
      "direction-1",
    ]);
  });

  it.each([GET, POST])("fails instead of returning incomplete data when a later page fails", async (handler) => {
    mockDatabase(largeDeck(), [], "flashcard_directions");
    const response = await handler(context());
    expect(response.status).toBe(500);
  });

  it.each([GET, POST])("rejects unauthenticated requests", async (handler) => {
    expect((await handler(context({}, null))).status).toBe(401);
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });
});
