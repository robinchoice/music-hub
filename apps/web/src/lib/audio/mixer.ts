// Plays all versions of a track in sync through Web Audio; only the solo version is audible.
// Switching fades over in about 15 ms and keeps the position. Where a browser cannot run several
// media elements at once (iOS Safari), only the solo version plays and switching carries the
// position over. The files stream instead of being decoded, which would take ~85 MB per version.

export type MixerSource = { id: string; url: string | null; duration: number | null };

type Channel = {
  id: string;
  el: HTMLAudioElement;
  duration: number;
  match: GainNode | null;
  gate: GainNode | null;
  meters: [AnalyserNode, AnalyserNode] | null;
  /** No stream URL, or the file cannot be played */
  broken: boolean;
};

// Time constant of the solo switch; it settles within about 15 ms
const FADE = 0.005;
// How far a version may drift from the clock before it is pulled back, in seconds
const DRIFT = 0.04;
const SYNC_MS = 500;

const toGain = (db: number) => 10 ** (db / 20);

export class Mixer {
  playing = false;
  /** Called when playback starts, stops or ends */
  onchange: () => void = () => {};

  private ctx: AudioContext | null = null;
  private channels: Channel[];
  private soloId: string;
  private gains = new Map<string, number>();
  private fallback = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private buffer = new Float32Array(1024);

  constructor(sources: MixerSource[], soloId: string) {
    this.soloId = soloId;
    this.channels = sources.map((s) => {
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      if (s.url) el.src = s.url;
      const ch: Channel = { id: s.id, el, duration: s.duration ?? Infinity, match: null, gate: null, meters: null, broken: !s.url };
      el.addEventListener('durationchange', () => {
        if (Number.isFinite(el.duration)) ch.duration = el.duration;
      });
      el.addEventListener('ended', () => this.ended());
      el.addEventListener('error', () => this.fail(ch));
      return ch;
    });
  }

  private get solo(): Channel {
    return this.channels.find((c) => c.id === this.soloId) ?? this.channels[0];
  }

  // The element that sets the time: the solo version, after its end the longest one
  private get clock(): Channel {
    const solo = this.solo;
    if (this.fallback || !solo.el.ended) return solo;
    return this.channels.reduce((a, b) => (b.duration > a.duration ? b : a));
  }

  position(): number {
    return this.clock.el.currentTime;
  }

  // Built on the first start, inside the click: browsers only allow audio after a gesture
  private graph(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    for (const ch of this.channels) {
      const source = ctx.createMediaElementSource(ch.el);
      const match = ctx.createGain();
      // Mono files are spread to both sides, so both meters move
      match.channelCount = 2;
      match.channelCountMode = 'explicit';
      match.channelInterpretation = 'speakers';
      match.gain.value = toGain(this.gains.get(ch.id) ?? 0);
      const gate = ctx.createGain();
      gate.gain.value = ch.id === this.soloId ? 1 : 0;
      const split = ctx.createChannelSplitter(2);
      const left = ctx.createAnalyser();
      const right = ctx.createAnalyser();
      left.fftSize = 1024;
      right.fftSize = 1024;
      source.connect(match);
      match.connect(gate).connect(ctx.destination);
      // The meters sit before the solo switch, so every strip shows its level
      match.connect(split);
      split.connect(left, 0);
      split.connect(right, 1);
      ch.match = match;
      ch.gate = gate;
      ch.meters = [left, right];
    }
    this.ctx = ctx;
    return ctx;
  }

  /** Versions that cannot be played */
  broken(): Set<string> {
    return new Set(this.channels.filter((ch) => ch.broken).map((ch) => ch.id));
  }

  async play() {
    // Nothing to hear; the strip says why
    if (this.solo.broken) return;
    void this.graph().resume();
    const t = this.position();
    const running = (this.fallback ? [this.solo] : this.channels).filter((ch) => !ch.broken && t < ch.duration);
    for (const ch of running) ch.el.currentTime = t;
    this.playing = true;
    this.onchange();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.sync(), SYNC_MS);
    const results = await Promise.allSettled(running.map((ch) => ch.el.play()));
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') return;
      // The browser refuses a further element: from here on only the solo version plays
      if ((r.reason as Error)?.name === 'NotAllowedError') this.useFallback();
      else this.fail(running[i]);
    });
  }

  // A version that cannot be played drops out; without the solo version the run stops
  private fail(ch: Channel) {
    if (ch.broken) return;
    ch.broken = true;
    ch.el.pause();
    if (ch === this.solo && this.playing) this.pause();
    else this.onchange();
  }

  pause() {
    for (const ch of this.channels) ch.el.pause();
    this.stop();
  }

  private stop() {
    clearInterval(this.timer);
    this.playing = false;
    this.onchange();
  }

  seek(seconds: number) {
    for (const ch of this.channels) ch.el.currentTime = Math.min(seconds, ch.duration);
    if (!this.playing) return;
    for (const ch of this.fallback ? [this.solo] : this.channels) {
      if (!ch.broken && seconds < ch.duration && ch.el.paused) ch.el.play().catch(() => {});
    }
  }

  setSolo(id: string) {
    if (id === this.soloId) return;
    const prev = this.solo;
    this.soloId = id;
    const next = this.solo;
    // Before the first start the gates follow soloId when the graph is built
    if (!this.ctx) return;
    if (this.fallback) {
      const t = prev.el.currentTime;
      prev.el.pause();
      prev.gate!.gain.value = 0;
      next.gate!.gain.value = 1;
      if (t < next.duration) next.el.currentTime = t;
      if (this.playing) next.el.play().catch(() => this.stop());
      return;
    }
    const now = this.ctx.currentTime;
    prev.gate!.gain.setTargetAtTime(0, now, FADE);
    next.gate!.gain.setTargetAtTime(1, now, FADE);
  }

  /** Loudness match per version in dB */
  setGains(gains: Map<string, number>) {
    this.gains = gains;
    if (!this.ctx) return;
    for (const ch of this.channels) {
      ch.match!.gain.setTargetAtTime(toGain(gains.get(ch.id) ?? 0), this.ctx.currentTime, 0.03);
    }
  }

  /** Peak level left and right per version, 0 to 1 */
  levels(): Map<string, [number, number]> {
    const out = new Map<string, [number, number]>();
    for (const ch of this.channels) {
      const live = this.playing && ch.meters && !ch.el.paused;
      out.set(ch.id, live ? [this.peak(ch.meters![0]), this.peak(ch.meters![1])] : [0, 0]);
    }
    return out;
  }

  private peak(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.buffer);
    let max = 0;
    for (const x of this.buffer) max = Math.max(max, Math.abs(x));
    return max;
  }

  // Twice a second: pull back versions that drifted more than 40 ms
  private sync() {
    if (!this.playing) return;
    // Paused from outside (media keys, headset, notification): nothing plays any more
    const live = this.channels.filter((ch) => !ch.broken && !ch.el.ended);
    const outside = this.fallback ? this.solo.el.paused && !this.solo.el.ended : live.length > 0 && live.every((ch) => ch.el.paused);
    if (outside) return this.pause();
    if (this.fallback) return;
    const clock = this.clock;
    const t = clock.el.currentTime;
    for (const ch of this.channels) {
      // Shorter versions fall silent at their end
      if (ch === clock || ch.broken || t >= ch.duration - 0.05) continue;
      // iOS pauses the other elements when one more starts
      if (ch.el.paused) return this.useFallback();
      if (Math.abs(ch.el.currentTime - t) > DRIFT) ch.el.currentTime = t;
    }
  }

  private useFallback() {
    if (this.fallback) return;
    this.fallback = true;
    // Take over the position from an element that still runs
    const running = this.channels.find((ch) => !ch.el.paused) ?? this.solo;
    const t = running.el.currentTime;
    for (const ch of this.channels) if (ch !== this.solo) ch.el.pause();
    if (!this.playing) return;
    if (t < this.solo.duration) this.solo.el.currentTime = t;
    this.solo.el.play().catch(() => this.stop());
  }

  // The run ends when every element has stopped; the position goes back to the start
  private ended() {
    if (!this.playing || !this.channels.every((ch) => ch.el.ended || ch.el.paused)) return;
    this.stop();
    this.seek(0);
    // Report the position at the start, not at the end
    this.onchange();
  }

  destroy() {
    clearInterval(this.timer);
    this.onchange = () => {};
    for (const ch of this.channels) {
      ch.el.pause();
      ch.el.removeAttribute('src');
      ch.el.load();
    }
    void this.ctx?.close();
  }
}
