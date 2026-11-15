import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as generate } from "../pages/api/stories/generate";
import { GET as getSettings, PUT as saveSettings } from "../pages/api/stories/settings";
import { POST as translate } from "../pages/api/stories/translate";

const mocks = vi.hoisted(() => ({ from: vi.fn(), fetch: vi.fn() }));
vi.mock("../lib/utils", () => ({
  getSupabaseClient: () => ({ from: mocks.from }),
  ensureUserExists: vi.fn(),
}));
vi.mock("../lib/tts-encryption", () => ({
  decrypt: vi.fn().mockResolvedValue("test-key"),
  encrypt: vi.fn(),
  setRuntimeEnv: vi.fn(),
}));

const ids = Array.from({ length: 150 }, (_, index) => `phrase-${index}`);
let settings: Record<string, unknown>;
let selectedIds: string[];
let inaccessible: boolean;
let saved: Record<string, unknown>;

function context(body?: unknown): APIContext {
  return {
    locals: { userId: "user-1" },
    request: new Request("http://localhost/api/stories", {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  } as APIContext;
}

function vocabularyFromRequest(): { english: string; polishMeaning: string }[] {
  const request = JSON.parse(mocks.fetch.mock.calls[0][1].body);
  const json = request.messages[1].content.split("<vocabulary-data>\n")[1].split("\n</vocabulary-data>")[0];
  return JSON.parse(json);
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.fetch.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "## English story\n\nA story." } }] }),
  });
  vi.stubGlobal("fetch", mocks.fetch);
  selectedIds = [];
  inaccessible = false;
  saved = {};
  settings = {
    encrypted_api_key: "encrypted-key",
    model: "deepseek-flash",
    prompt: "Write a story.",
    max_phrases: 30,
    max_tokens: 64000,
    temperature: 0.8,
    thinking_enabled: false,
    thinking_effort: "low",
    tts_voice_id: "en-GB-Chirp3-HD-Kore",
    tts_speaking_rate: 1,
  };
  mocks.from.mockReset().mockImplementation((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      in: vi.fn((_column: string, values: string[]) => {
        selectedIds = values;
        return query;
      }),
      update: vi.fn((value: Record<string, unknown>) => {
        saved = value;
        settings = { ...settings, ...value };
        return query;
      }),
      single: vi.fn(async () => ({ data: settings, error: null })),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data:
            table === "phrases"
              ? selectedIds.slice(inaccessible ? 1 : 0).map((id) => ({
                  id,
                  en_text: `${id} ${"English expression ".repeat(5)}`,
                  pl_text: `${id} ${"Polskie znaczenie ".repeat(5)}`,
                }))
              : settings,
          error: null,
        }).then(resolve),
    };
    return query;
  });
});

describe("story phrase selection", () => {
  it("samples the configured maximum from a larger selection and returns the actual IDs", async () => {
    settings.max_phrases = 50;
    vi.spyOn(Math, "random").mockReturnValue(0);
    const response = await generate(context({ phrase_ids: ids }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.phrase_ids).toEqual(selectedIds);
    expect(selectedIds).toHaveLength(50);
    expect(new Set(selectedIds).size).toBe(50);
    expect(selectedIds).not.toContain(ids[0]);
    expect(selectedIds.every((id) => ids.includes(id))).toBe(true);
    expect(vocabularyFromRequest().map((phrase) => phrase.english.split(" ")[0])).toEqual(selectedIds);
    expect(ids[0]).toBe("phrase-0");
  });

  it("defaults to 30 when a settings value is absent", async () => {
    delete settings.max_phrases;
    expect((await generate(context({ phrase_ids: ids }))).status).toBe(200);
    expect(selectedIds).toHaveLength(30);
  });

  it.each([3, 30, 50, 100])("keeps all %i phrases when within the limit", async (count) => {
    settings.max_phrases = 100;
    const response = await generate(context({ phrase_ids: ids.slice(0, count) }));
    expect(response.status).toBe(200);
    expect([...selectedIds].sort()).toEqual(ids.slice(0, count).sort());
    expect(vocabularyFromRequest()).toHaveLength(count);
  });

  it.each([
    [ids[0], ids[1]],
    [ids[0], ids[0], ids[1]],
  ])("rejects too few or duplicate IDs: %j", async (...input) => {
    expect((await generate(context({ phrase_ids: input }))).status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects inaccessible sampled phrases before contacting the model", async () => {
    inaccessible = true;
    expect((await generate(context({ phrase_ids: ids }))).status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("allows translation of 50 selected phrases with a vocabulary exceeding the old size limit", async () => {
    const response = await translate(
      context({ content: "## English story\n\nA story.", phrase_ids: ids.slice(0, 50) })
    );
    expect(response.status).toBe(200);
    expect(vocabularyFromRequest()).toHaveLength(50);
  });
});

describe("story phrase limit settings", () => {
  it.each([3, 30, 50, 100])("saves and reads a limit of %i", async (limit) => {
    const response = await saveSettings(context({ ...settings, max_phrases: limit }));
    expect(response.status).toBe(200);
    expect(saved.max_phrases).toBe(limit);
    expect((await (await getSettings(context())).json()).max_phrases).toBe(limit);
  });

  it.each([2, 101, 3.5, "50", null])("rejects an invalid limit %j", async (limit) => {
    expect((await saveSettings(context({ ...settings, max_phrases: limit }))).status).toBe(400);
    expect(saved).toEqual({});
  });
});
