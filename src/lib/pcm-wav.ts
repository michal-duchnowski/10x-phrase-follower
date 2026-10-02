import { LIVE_AUDIO_SAMPLE_RATE } from "./story-live-audio";

const WAV_HEADER_BYTES = 44;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

export function createPcmWavBytes(pcm: Uint8Array, sampleRate = LIVE_AUDIO_SAMPLE_RATE): Uint8Array {
  const wav = new Uint8Array(WAV_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(wav.buffer);
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const byteRate = sampleRate * CHANNELS * bytesPerSample;

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, wav.byteLength - 8, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, CHANNELS * bytesPerSample, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.byteLength, true);
  wav.set(pcm, WAV_HEADER_BYTES);
  return wav;
}

export function createPcmWavBlob(pcm: Uint8Array): Blob {
  return new Blob([createPcmWavBytes(pcm)], { type: "audio/wav" });
}

export function getPcmDurationSeconds(pcm: Uint8Array, sampleRate = LIVE_AUDIO_SAMPLE_RATE): number {
  return pcm.byteLength / 2 / sampleRate;
}
