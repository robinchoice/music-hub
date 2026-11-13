// Third-octave spectrum and stereo image of a mix, ported from pinna-analysis (Pinna, by Robin, MIT OR
// Apache-2.0). Loudness, true peak and range stay with ffmpeg (services/audio-processor.ts). The Meter takes
// the samples block by block, so a long mix never sits in memory as a whole. Values and their edge cases are
// described in packages/shared/src/measurements.ts.
import { CAP, FLOOR_DB, measurementsSchema, THIRD_OCTAVE_HZ, type Measurements } from '@music-hub/shared';
import { z } from 'zod';

const BANDS = THIRD_OCTAVE_HZ.length;

/** Exact base-10 edges of band i of THIRD_OCTAVE_HZ */
export function bandEdges(i: number): [number, number] {
  const fm = 1000 * 10 ** ((i - 17) / 10);
  return [fm * 10 ** -0.05, fm * 10 ** 0.05];
}

const capped = (x: number) => Math.min(CAP, Math.max(-CAP, x));
const db = (power: number) => Math.max(FLOOR_DB, 10 * Math.log10(power));
// a - b for levels that may be -Infinity: equal levels give 0, the rest is capped
const diff = (a: number, b: number) => (a === b ? 0 : capped(a - b));
const ratioDb = (num: number, den: number) => (num === 0 ? 0 : capped(10 * Math.log10(num / den)));

/** Biquad in transposed direct form II, a without a0 = 1 */
class Biquad {
  private s0 = 0;
  private s1 = 0;
  constructor(private readonly b: [number, number, number], private readonly a: [number, number]) {}

  run(x: number) {
    const y = this.b[0] * x + this.s0;
    this.s0 = this.b[1] * x - this.a[0] * y + this.s1;
    this.s1 = this.b[2] * x - this.a[1] * y;
    return y;
  }
}

/** The K-weighting of ITU-R BS.1770 for any sample rate, as libebur128 derives it: high shelf, then high-pass */
function kWeighting(sr: number): [Biquad, Biquad] {
  let k = Math.tan((Math.PI * 1681.974450955533) / sr);
  let q = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf = new Biquad(
    [(vh + (vb * k) / q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q + k * k) / a0],
    [(2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0],
  );
  k = Math.tan((Math.PI * 38.13547087602444) / sr);
  q = 0.5003270373238773;
  a0 = 1 + k / q + k * k;
  return [shelf, new Biquad([1, -2, 1], [(2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0])];
}

/** Gated integrated loudness (EBU R128) from the mean squares of 400 ms blocks, LUFS; -Infinity without a block above the gates */
function integrated(blocks: number[]) {
  const loud = (z: number) => -0.691 + 10 * Math.log10(z);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const above = blocks.filter((z) => loud(z) > -70);
  if (!above.length) return -Infinity;
  const relative = loud(mean(above)) - 10;
  return loud(mean(above.filter((z) => loud(z) > relative)));
}

/** In-place radix-2 complex FFT of a fixed size */
class Fft {
  readonly re: Float64Array;
  readonly im: Float64Array;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(readonly n: number) {
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
  }

  run() {
    const { n, re, im, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) {
        [re[i], re[j]] = [re[j]!, re[i]!];
        [im[i], im[j]] = [im[j]!, im[i]!];
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step]!;
          const wi = sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const tr = re[b]! * wr - im[b]! * wi;
          const ti = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - tr;
          im[b] = im[a]! - ti;
          re[a] = re[a]! + tr;
          im[a] = im[a]! + ti;
        }
      }
    }
  }
}

const hann = (len: number) => Float64Array.from({ length: len }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / len));

export type Measured = Measurements & { /** Not stored, ffmpeg measures it for the version; here for the tests */ integratedLufs: number };

/**
 * Takes interleaved stereo frames at `sr` Hz. Bands: Welch's method with a Hann window, 50 % overlap and bins at
 * most 0.75 Hz apart, which resolves the 20 Hz band; the last window ends with the input. L, R and the mono fold
 * (L+R)/2 share one complex FFT: L real, R imaginary, the fold is linear in both.
 */
export class Meter {
  private readonly n: number;
  private readonly fft: Fft;
  private readonly window: Float64Array;
  private readonly bins: [number, number][];
  private readonly ringL: Float32Array;
  private readonly ringR: Float32Array;
  private pos = 0;
  private total = 0;
  private lastStart = -1;
  private windows = 0;
  private windowEnergy = 0;
  private readonly power = { l: new Float64Array(BANDS), r: new Float64Array(BANDS), m: new Float64Array(BANDS) };

  private ll = 0;
  private rr = 0;
  private lr = 0;

  private readonly kl: [Biquad, Biquad];
  private readonly kr: [Biquad, Biquad];
  private readonly km: [Biquad, Biquad];
  private readonly subLength: number;
  private subFill = 0;
  private subStereo = 0;
  private subMono = 0;
  private readonly subs: { stereo: number[]; mono: number[] } = { stereo: [], mono: [] };
  private finished: Measured | null = null;

  constructor(private readonly sr: number) {
    this.n = 2 ** Math.ceil(Math.log2(Math.ceil(sr / 0.75)));
    this.fft = new Fft(this.n);
    this.window = hann(this.n);
    const bin = (f: number) => Math.min(Math.ceil((f * this.n) / sr), this.n / 2 + 1);
    this.bins = THIRD_OCTAVE_HZ.map((_, b) => {
      const [f1, f2] = bandEdges(b);
      return [bin(f1), bin(f2)];
    });
    this.ringL = new Float32Array(this.n);
    this.ringR = new Float32Array(this.n);
    this.kl = kWeighting(sr);
    this.kr = kWeighting(sr);
    this.km = kWeighting(sr);
    this.subLength = Math.round(sr / 10);
  }

  push(frames: Float32Array) {
    if (this.finished) throw new Error('Meter already finished');
    const k = (f: [Biquad, Biquad], x: number) => f[1].run(f[0].run(x));
    for (let i = 0; i + 1 < frames.length; i += 2) {
      const l = frames[i]!;
      const r = frames[i + 1]!;
      this.ll += l * l;
      this.rr += r * r;
      this.lr += l * r;

      const kl = k(this.kl, l);
      const kr = k(this.kr, r);
      const km = k(this.km, (l + r) / 2);
      this.subStereo += kl * kl + kr * kr;
      this.subMono += km * km;
      if (++this.subFill === this.subLength) {
        this.subs.stereo.push(this.subStereo);
        this.subs.mono.push(this.subMono);
        this.subFill = this.subStereo = this.subMono = 0;
      }

      this.ringL[this.pos] = l;
      this.ringR[this.pos] = r;
      if (++this.pos === this.n) this.pos = 0;
      this.total++;
      if (this.total >= this.n && (this.total - this.n) % (this.n / 2) === 0) this.analyse(this.n);
    }
  }

  /** The window over the last `win` samples */
  private analyse(win: number) {
    const { n, fft, ringL, ringR } = this;
    const w = win === n ? this.window : hann(win);
    // A full ring starts at pos, a ring that never filled at 0
    const start = win === n ? this.pos : 0;
    for (let i = 0; i < n; i++) {
      const at = (start + i) % n;
      fft.re[i] = i < win ? ringL[at]! * w[i]! : 0;
      fft.im[i] = i < win ? ringR[at]! * w[i]! : 0;
    }
    fft.run();
    const { re, im } = fft;
    for (let b = 0; b < BANDS; b++) {
      const [k1, k2] = this.bins[b]!;
      let pl = 0;
      let pr = 0;
      let pm = 0;
      for (let k = k1; k < k2; k++) {
        const j = (n - k) % n;
        // Spectra of L and R from the packed one: X = (Z[k] + conj Z[n-k]) / 2, Y = (Z[k] - conj Z[n-k]) / 2i
        const xr = (re[k]! + re[j]!) / 2;
        const xi = (im[k]! - im[j]!) / 2;
        const yr = (im[k]! + im[j]!) / 2;
        const yi = (re[j]! - re[k]!) / 2;
        // One-sided spectrum: every bin but Nyquist stands for two
        const both = k === n / 2 ? 1 : 2;
        pl += (xr * xr + xi * xi) * both;
        pr += (yr * yr + yi * yi) * both;
        pm += (((xr + yr) / 2) ** 2 + ((xi + yi) / 2) ** 2) * both;
      }
      this.power.l[b]! += pl;
      this.power.r[b]! += pr;
      this.power.m[b]! += pm;
    }
    this.windows++;
    this.windowEnergy = w.reduce((s, v) => s + v * v, 0);
    this.lastStart = this.total - win;
  }

  result(): Measured {
    if (this.finished) return this.finished;
    if (this.total >= this.n && this.lastStart !== this.total - this.n) this.analyse(this.n);
    else if (this.total > 0 && this.total < this.n) this.analyse(this.total);

    const scale = this.windows ? 1 / (this.n * this.windowEnergy * this.windows) : 0;
    const { l, r, m } = this.power;

    const { ll, rr, lr } = this;
    const correlation = ll === 0 && rr === 0 ? 1 : ll === 0 || rr === 0 ? 0 : Math.min(1, Math.max(-1, lr / Math.sqrt(ll * rr)));
    // Mid and side energies times 4; rounding can push either just below 0
    const mid = Math.max(0, ll + rr + 2 * lr);
    const side = ll + rr - 2 * lr;
    const width = side > 0 ? Math.min(CAP, side / mid) : 0;

    const blocks = (subs: number[], channels: number) =>
      subs.slice(3).map((_, j) => (subs[j]! + subs[j + 1]! + subs[j + 2]! + subs[j + 3]!) * channels / (4 * this.subLength));
    const stereo = integrated(blocks(this.subs.stereo, 1));
    // The fold plays on both channels
    const mono = integrated(blocks(this.subs.mono, 2));

    this.finished = {
      bands: Array.from(l, (_, b) => db((l[b]! + r[b]!) * scale)),
      correlation,
      width,
      monoLossLu: diff(stereo, mono),
      monoLossBands: Array.from(l, (_, b) => ratioDb(l[b]! + r[b]!, 2 * m[b]!)),
      integratedLufs: stereo,
    };
    return this.finished;
  }
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/** What the version stores: tenths of a dB are as fine as anyone hears */
export function stored(m: Measured): Measurements {
  return {
    bands: m.bands.map((b) => round(b, 1)),
    correlation: round(m.correlation, 3),
    width: round(m.width, 3),
    monoLossLu: round(m.monoLossLu, 2),
    monoLossBands: m.monoLossBands.map((b) => round(b, 1)),
  };
}

/** The line services/mix-measurement.ts prints; null for anything else */
export function parseMeasurements(output: string): Measurements | null {
  try {
    return measurementsSchema.parse(JSON.parse(output));
  } catch {
    return null;
  }
}

/** The same line for a reference track, with the loudness the comparison matches to */
export function parseMeasuredFile(output: string): { measurements: Measurements; integratedLufs: number | null } | null {
  try {
    const { integratedLufs, ...measurements } = measurementsSchema.extend({ integratedLufs: z.number().nullable() }).parse(JSON.parse(output));
    return { measurements, integratedLufs };
  } catch {
    return null;
  }
}
