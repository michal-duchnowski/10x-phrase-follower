import { LIVE_AUDIO_SAMPLE_RATE } from "./story-live-audio";

const INITIAL_BUFFER_SECONDS = 0.25;
const SCHEDULE_LEAD_SECONDS = 0.06;

export class PcmStreamPlayer {
  private readonly queued: Float32Array[] = [];
  private readonly sources = new Set<AudioBufferSourceNode>();
  private queuedSamples = 0;
  private nextStartTime = 0;
  private firstStartTime: number | null = null;
  private scheduledSamples = 0;
  private started = false;
  private stopped = false;
  private oddByte: number | null = null;
  private lastSource: AudioBufferSourceNode | null = null;

  constructor(
    private readonly context: AudioContext,
    private readonly sampleRate = LIVE_AUDIO_SAMPLE_RATE
  ) {}

  push(bytes: Uint8Array): void {
    if (this.stopped || bytes.byteLength === 0) return;

    let pcm = bytes;
    if (this.oddByte !== null) {
      const joined = new Uint8Array(bytes.byteLength + 1);
      joined[0] = this.oddByte;
      joined.set(bytes, 1);
      pcm = joined;
      this.oddByte = null;
    }
    if (pcm.byteLength % 2 === 1) {
      this.oddByte = pcm[pcm.byteLength - 1];
      pcm = pcm.subarray(0, pcm.byteLength - 1);
    }
    if (pcm.byteLength === 0) return;

    const samples = new Float32Array(pcm.byteLength / 2);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32_768;
    }

    if (this.started) {
      this.schedule(samples);
      return;
    }
    this.queued.push(samples);
    this.queuedSamples += samples.length;
    if (this.queuedSamples >= this.sampleRate * INITIAL_BUFFER_SECONDS) this.flushQueue();
  }

  async finish(): Promise<void> {
    if (this.stopped) return;
    this.flushQueue();
    const lastSource = this.lastSource;
    if (!lastSource) return;
    await new Promise<void>((resolve) => {
      const remainingMs = Math.max(0, (this.nextStartTime - this.context.currentTime) * 1_000);
      window.setTimeout(resolve, remainingMs + 100);
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
    }
    this.sources.clear();
    this.queued.length = 0;
  }

  getPositionSeconds(): number {
    if (this.firstStartTime === null) return 0;
    const scheduledDuration = this.scheduledSamples / this.sampleRate;
    return Math.min(scheduledDuration, Math.max(0, this.context.currentTime - this.firstStartTime));
  }

  private flushQueue(): void {
    if (this.started || this.queuedSamples === 0) return;
    const samples = new Float32Array(this.queuedSamples);
    let offset = 0;
    for (const chunk of this.queued) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.queued.length = 0;
    this.queuedSamples = 0;
    this.started = true;
    this.schedule(samples);
  }

  private schedule(samples: Float32Array): void {
    if (this.stopped || samples.length === 0) return;
    const buffer = this.context.createBuffer(1, samples.length, this.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const earliestStart = this.context.currentTime + SCHEDULE_LEAD_SECONDS;
    const startAt = Math.max(this.nextStartTime, earliestStart);
    if (this.firstStartTime === null) this.firstStartTime = startAt;
    source.start(startAt);
    this.scheduledSamples += samples.length;
    this.nextStartTime = startAt + buffer.duration;
    this.lastSource = source;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }
}
