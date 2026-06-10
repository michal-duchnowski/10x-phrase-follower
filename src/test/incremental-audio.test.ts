import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const decryptMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("../lib/tts-encryption", () => ({
  decrypt: (...args: unknown[]) => decryptMock(...args),
  setRuntimeEnv: vi.fn(),
}));

vi.mock("../lib/utils", async () => {
  const actual = await vi.importActual<typeof import("../lib/utils")>("../lib/utils");
  return {
    ...actual,
    getSupabaseEnvVars: vi.fn(() => ({
      supabaseUrl: "http://supabase.test",
      supabaseServiceKey: "service-role-key",
    })),
  };
});

import { runIncrementalAudioGeneration } from "../lib/incremental-audio";

function createQueryChain(result: { data?: unknown; error?: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(async () => result),
  };

  return chain;
}

describe("incremental audio generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decryptMock.mockResolvedValue("decrypted-api-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ audioContent: "dGVzdA==" }),
      }))
    );
  });

  it("skips generation when notebook has no current build", async () => {
    const insertSpy = vi.fn();
    const uploadSpy = vi.fn();

    createClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "notebooks") {
          return createQueryChain({ data: { id: "nb-1", current_build_id: null }, error: null });
        }
        if (table === "audio_segments") {
          return { insert: insertSpy };
        }
        return createQueryChain({ data: [], error: null });
      }),
      storage: {
        from: vi.fn(() => ({
          upload: uploadSpy,
        })),
      },
    });

    await runIncrementalAudioGeneration({
      context: {
        locals: {},
        request: new Request("http://localhost/test"),
      } as never,
      userId: "user-1",
      notebookId: "nb-1",
      phraseIds: ["phrase-1"],
      source: "create_phrase",
    });

    expect(insertSpy).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("generates and inserts segments only for new phrases", async () => {
    const insertSpy = vi.fn(async () => ({ error: null }));
    const uploadSpy = vi.fn(async () => ({ error: null }));

    const fromMock = vi.fn((table: string) => {
      if (table === "notebooks") {
        return createQueryChain({ data: { id: "nb-1", current_build_id: "build-1" }, error: null });
      }
      if (table === "jobs") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() => ({
                limit: vi.fn(async () => ({ data: [], error: null })),
              })),
            })),
          })),
        };
      }
      if (table === "tts_credentials") {
        return createQueryChain({
          data: { encrypted_key: "encrypted", is_configured: true },
          error: null,
        });
      }
      if (table === "user_voices") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({
                data: [
                  { slot: "EN1", language: "en", voice_id: "en-voice" },
                  { slot: "PL", language: "pl", voice_id: "pl-voice" },
                ],
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "phrases") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() => ({
                order: vi.fn(async () => ({
                  data: [{ id: "phrase-1", en_text: "hello", pl_text: "czesc" }],
                  error: null,
                })),
              })),
            })),
          })),
        };
      }
      if (table === "audio_segments") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async () => ({
                data: [],
                error: null,
              })),
            })),
          })),
          insert: insertSpy,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    createClientMock.mockReturnValue({
      from: fromMock,
      storage: {
        from: vi.fn(() => ({
          upload: uploadSpy,
        })),
      },
    });

    await runIncrementalAudioGeneration({
      context: {
        locals: {},
        request: new Request("http://localhost/test"),
      } as never,
      userId: "user-1",
      notebookId: "nb-1",
      phraseIds: ["phrase-1"],
      source: "append_import",
    });

    expect(decryptMock).toHaveBeenCalledWith("encrypted");
    expect(uploadSpy).toHaveBeenCalledTimes(2);
    expect(insertSpy).toHaveBeenCalledTimes(1);

    const insertedSegments = insertSpy.mock.calls[0][0] as {
      phrase_id: string;
      voice_slot: string;
      build_id: string;
    }[];
    expect(insertedSegments).toHaveLength(2);
    expect(insertedSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phrase_id: "phrase-1", voice_slot: "EN1", build_id: "build-1" }),
        expect.objectContaining({ phrase_id: "phrase-1", voice_slot: "PL", build_id: "build-1" }),
      ])
    );
  });
});
