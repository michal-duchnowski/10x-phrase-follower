import { beforeEach, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { POST } from "../pages/api/phrases/image-import";
import { getSupabaseClient } from "../lib/utils";
vi.mock("../lib/utils", () => ({ getSupabaseClient: vi.fn() }));
const id = "550e8400-e29b-41d4-a716-446655440000";
const context = (userId: string | null, ids: unknown) =>
  ({
    locals: { userId },
    request: new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ ids }),
      headers: { "Content-Type": "application/json" },
    }),
  }) as unknown as APIContext;
beforeEach(() => vi.clearAllMocks());
it("requires authentication and validates batch IDs before querying", async () => {
  expect((await POST(context(null, [id]))).status).toBe(401);
  expect((await POST(context(id, ["invalid"]))).status).toBe(400);
  expect((await POST(context(id, Array(201).fill(id)))).status).toBe(400);
  expect(getSupabaseClient).not.toHaveBeenCalled();
});
it("restricts returned metadata to the owner and omits joined account information", async () => {
  const query = { select: vi.fn(), in: vi.fn(), eq: vi.fn() };
  query.select.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.eq.mockResolvedValue({
    data: [{ id, en_text: "Ice", pl_text: "Lód", image_url: null, updated_at: "v1", notebooks: { user_id: id } }],
    error: null,
  });
  vi.mocked(getSupabaseClient).mockReturnValue({ from: () => query } as unknown as ReturnType<
    typeof getSupabaseClient
  >);
  const response = await POST(context(id, [id]));
  expect(response.status).toBe(200);
  expect(query.eq).toHaveBeenCalledWith("notebooks.user_id", id);
  expect((await response.json()).items[0]).toEqual({
    id,
    en_text: "Ice",
    pl_text: "Lód",
    image_url: null,
    updated_at: "v1",
  });
});
