import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { PATCH as updatePhrase } from "../pages/api/phrases/[phraseId]";
import { PATCH as saveSettings } from "../pages/api/flashcards/settings";
import { getSupabaseClient } from "../lib/utils";

vi.mock("../lib/utils", () => ({ getSupabaseClient: vi.fn(), ensureUserExists: vi.fn() }));
const write = vi.fn();
const phraseId = "ddc915d5-5d11-4553-9cf0-d689e83cb82d";
function context(body: unknown, userId: string | null = "user-1") {
  return {
    locals: { userId },
    params: { phraseId },
    request: new Request("https://example.com/api/phrases/" + phraseId, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  } as unknown as APIContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSupabaseClient).mockReturnValue({
    from: () => {
      let values: Record<string, unknown> = {};
      const query = {
        update: (value: Record<string, unknown>) => {
          values = value;
          write(value);
          return query;
        },
        upsert: (value: Record<string, unknown>) => {
          values = value;
          write(value);
          return query;
        },
        eq: () => query,
        is: () => query,
        select: () => query,
        single: async () => ({ data: { ...values, id: phraseId, notebook: { user_id: "user-1" } }, error: null }),
      };
      return query;
    },
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe("phrase image persistence", () => {
  it("saves an image without overwriting the hint or phrase text", async () => {
    const response = await updatePhrase(context({ image_url: " https://example.com/photo.jpg " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ image_url: "https://example.com/photo.jpg" });
    expect(write.mock.calls[0][0]).toEqual({
      image_url: "https://example.com/photo.jpg",
      updated_at: expect.any(String),
    });
  });
  it("removes the image link", async () => {
    const response = await updatePhrase(context({ image_url: null }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ image_url: null });
  });
  it("rejects invalid links before writing", async () => {
    expect((await updatePhrase(context({ image_url: "javascript:alert(1)" }))).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    expect((await updatePhrase(context({ image_url: null }, null))).status).toBe(401);
    expect(write).not.toHaveBeenCalled();
  });
  it("saves bounded image dimensions with other settings left intact", async () => {
    const response = await saveSettings(context({ image_max_width: 300, image_max_height: 200 }));
    expect(response.status).toBe(200);
    expect(write.mock.calls[0][0]).toEqual({
      user_id: "user-1",
      image_max_width: 300,
      image_max_height: 200,
      updated_at: expect.any(String),
    });
  });
  it.each([{ image_max_width: 481 }, { image_max_height: 89 }, { image_max_width: 240.5 }])(
    "rejects invalid dimensions %s",
    async (values) => {
      expect((await saveSettings(context(values))).status).toBe(400);
      expect(write).not.toHaveBeenCalled();
    }
  );
});
