import { describe, expect, it } from "vitest";
import { createPcmWavBytes, getPcmDurationSeconds } from "./pcm-wav";

describe("PCM WAV conversion", () => {
  it("wraps raw mono PCM in a seekable 24 kHz WAV header", () => {
    const pcm = Uint8Array.from([1, 2, 3, 4]);
    const wav = createPcmWavBytes(pcm);
    const view = new DataView(wav.buffer);

    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(pcm.byteLength);
    expect(wav.slice(44)).toEqual(pcm);
  });

  it("calculates duration from 16-bit mono samples", () => {
    expect(getPcmDurationSeconds(new Uint8Array(48_000))).toBe(1);
  });
});
