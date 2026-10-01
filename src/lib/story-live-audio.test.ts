import { describe, expect, it } from "vitest";
import {
  encodeLiveAudioFrame,
  LIVE_AUDIO_FRAME,
  LiveAudioFrameDecoder,
  splitTextForStreaming,
} from "./story-live-audio";

describe("live story audio framing", () => {
  it("decodes frames split across arbitrary HTTP chunks", () => {
    const audioPayload = Uint8Array.from([1, 2, 3, 4]);
    const errorPayload = new TextEncoder().encode('{"code":"TEST"}');
    const bytes = new Uint8Array([
      ...encodeLiveAudioFrame(LIVE_AUDIO_FRAME.audio, audioPayload),
      ...encodeLiveAudioFrame(LIVE_AUDIO_FRAME.error, errorPayload),
      ...encodeLiveAudioFrame(LIVE_AUDIO_FRAME.end),
    ]);
    const decoder = new LiveAudioFrameDecoder();

    const frames = [
      ...decoder.push(bytes.slice(0, 3)),
      ...decoder.push(bytes.slice(3, 9)),
      ...decoder.push(bytes.slice(9)),
    ];
    decoder.finish();

    expect(frames.map((frame) => frame.type)).toEqual([
      LIVE_AUDIO_FRAME.audio,
      LIVE_AUDIO_FRAME.error,
      LIVE_AUDIO_FRAME.end,
    ]);
    expect(frames[0].payload).toEqual(audioPayload);
    expect(new TextDecoder().decode(frames[1].payload)).toBe('{"code":"TEST"}');
  });

  it("rejects a truncated final frame", () => {
    const decoder = new LiveAudioFrameDecoder();
    decoder.push(encodeLiveAudioFrame(LIVE_AUDIO_FRAME.audio, Uint8Array.from([1, 2])).slice(0, -1));
    expect(() => decoder.finish()).toThrow("incomplete frame");
  });
});

describe("streaming text chunks", () => {
  it("keeps short complete sentences separate", () => {
    expect(splitTextForStreaming("First sentence. Second sentence! Third sentence?")).toEqual([
      "First sentence.",
      "Second sentence!",
      "Third sentence?",
    ]);
  });

  it("keeps every chunk within the configured UTF-8 byte limit", () => {
    const chunks = splitTextForStreaming("Zażółć gęślą jaźń and continue with another phrase.", 24);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => new TextEncoder().encode(chunk).byteLength <= 24)).toBe(true);
  });
});
