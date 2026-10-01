export const LIVE_AUDIO_CONTENT_TYPE = "application/x-story-live-audio";
export const LIVE_AUDIO_SAMPLE_RATE = 24_000;

export const LIVE_AUDIO_FRAME = {
  audio: 1,
  error: 2,
  end: 3,
} as const;

export type LiveAudioFrameType = (typeof LIVE_AUDIO_FRAME)[keyof typeof LIVE_AUDIO_FRAME];

export interface LiveAudioFrame {
  type: LiveAudioFrameType;
  payload: Uint8Array;
}

const FRAME_HEADER_BYTES = 5;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export function encodeLiveAudioFrame(type: LiveAudioFrameType, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength);
  frame[0] = type;
  new DataView(frame.buffer).setUint32(1, payload.byteLength, false);
  frame.set(payload, FRAME_HEADER_BYTES);
  return frame;
}

export class LiveAudioFrameDecoder {
  private pending = new Uint8Array();

  push(chunk: Uint8Array): LiveAudioFrame[] {
    const next = new Uint8Array(this.pending.byteLength + chunk.byteLength);
    next.set(this.pending);
    next.set(chunk, this.pending.byteLength);
    this.pending = next;

    const frames: LiveAudioFrame[] = [];
    let offset = 0;
    while (this.pending.byteLength - offset >= FRAME_HEADER_BYTES) {
      const type = this.pending[offset] as LiveAudioFrameType;
      if (!Object.values(LIVE_AUDIO_FRAME).includes(type)) throw new Error("Live audio returned an invalid frame type");

      const payloadLength = new DataView(this.pending.buffer, this.pending.byteOffset + offset + 1, 4).getUint32(
        0,
        false
      );
      if (payloadLength > MAX_FRAME_BYTES) throw new Error("Live audio returned an oversized frame");
      if (this.pending.byteLength - offset < FRAME_HEADER_BYTES + payloadLength) break;

      const payloadStart = offset + FRAME_HEADER_BYTES;
      frames.push({ type, payload: this.pending.slice(payloadStart, payloadStart + payloadLength) });
      offset = payloadStart + payloadLength;
    }

    this.pending = this.pending.slice(offset);
    return frames;
  }

  finish(): void {
    if (this.pending.byteLength !== 0) throw new Error("Live audio ended with an incomplete frame");
  }
}

export function splitTextForStreaming(text: string, maxUtf8Bytes = 1_000): string[] {
  const sentences = text
    .match(/[^.!?\n]+(?:[.!?]+|$)|[^\n]+/g)
    ?.map((part) => part.trim())
    .filter(Boolean) ?? [text];
  const chunks: string[] = [];
  const encoder = new TextEncoder();

  for (const sentence of sentences) {
    let current = "";
    for (const word of sentence.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (encoder.encode(candidate).byteLength <= maxUtf8Bytes) {
        current = candidate;
        continue;
      }
      if (current) chunks.push(current);
      current = word;
    }
    if (current) chunks.push(current);
  }

  return chunks;
}
