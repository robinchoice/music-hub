import { expect, test } from 'bun:test';
import fc from 'fast-check';
import { CAP, compareMeasurements, FLOOR_DB, type Measurements } from '@music-hub/shared';
import { bandEdges, Meter, parseMeasurements, stored, type Measured } from './lib/measure.js';

// Ported from the tests of pinna-analysis, with the stems-only masking left out
const SR = 48_000;
const secs = (s: number) => Math.floor(s * SR);

const sine = (hz: number, amp: number, s: number) => Float32Array.from({ length: secs(s) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));

/** White noise in [-amp, amp] from a fixed seed (xorshift64 as in Pinna, so the same samples) */
function noise(seed: number, amp: number, s: number) {
  const mask = (1n << 64n) - 1n;
  let x = BigInt(seed);
  return Float32Array.from({ length: secs(s) }, () => {
    x ^= (x << 13n) & mask;
    x ^= x >> 7n;
    x ^= (x << 17n) & mask;
    return amp * ((Number(x >> 11n) / 2 ** 53) * 2 - 1);
  });
}

/** 4th-order Butterworth high-pass (two RBJ biquads) */
function highpass(x: Float32Array, hz: number) {
  let y = Float64Array.from(x);
  for (const q of [0.5412, 1.3066]) {
    const w = (2 * Math.PI * hz) / SR;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const b = [(1 + Math.cos(w)) / 2, -(1 + Math.cos(w)), (1 + Math.cos(w)) / 2].map((v) => v / a0) as [number, number, number];
    const a = [(-2 * Math.cos(w)) / a0, (1 - alpha) / a0] as const;
    let [x1, x2, y1, y2] = [0, 0, 0, 0];
    y = y.map((v) => {
      const out = b[0] * v + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      [x2, x1, y2, y1] = [x1, v, y1, out];
      return out;
    });
  }
  return Float32Array.from(y);
}

const interleave = (l: Float32Array, r: Float32Array) => {
  const out = new Float32Array(l.length * 2);
  l.forEach((v, i) => {
    out[2 * i] = v;
    out[2 * i + 1] = r[i]!;
  });
  return out;
};

function measure(l: Float32Array, r: Float32Array = l) {
  const meter = new Meter(SR);
  meter.push(interleave(l, r));
  return meter.result();
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const db = (amp: number) => 20 * Math.log10(amp);

test('the mono fold reads -20 LUFS for a 1 kHz sine at 0.1 on both channels, silence has no loudness', () => {
  expect(measure(sine(1000, 0.1, 5)).integratedLufs).toBeCloseTo(-20, 1);
  expect(measure(new Float32Array(secs(5))).integratedLufs).toBe(-Infinity);
  // Shorter than one 400 ms block
  expect(measure(sine(1000, 0.1, 0.3)).integratedLufs).toBe(-Infinity);
});

test('a quiet passage below the relative gate does not lower the loudness', () => {
  const loud = sine(1000, 0.1, 5);
  const quiet = sine(1000, 0.001, 5);
  const both = new Float32Array(loud.length + quiet.length);
  both.set(loud);
  both.set(quiet, loud.length);
  // Three blocks straddle the step and count, half loud on average
  expect(measure(both).integratedLufs).toBeCloseTo(-20 + 10 * Math.log10(48.5 / 50), 1);
});

test('third-octave bands resolve a sine at each band centre', () => {
  for (const [hz, band] of [[31.5, 2], [50, 4], [1000, 17], [10_000, 27]] as const) {
    const { bands } = measure(sine(hz, 0.5, 4));
    expect(near(bands[band]!, db(0.5), 0.5)).toBe(true);
    expect(bands[band - 1]!).toBeLessThan(db(0.5) - 10);
    expect(bands[band + 1]!).toBeLessThan(db(0.5) - 10);
  }
  // One channel only: 3 dB less
  const s = sine(1000, 1, 2);
  expect(measure(s, new Float32Array(s.length)).bands[17]!).toBeCloseTo(-3.01, 1);
});

test('band edges are base-10 thirds around the nominal centres', () => {
  const [f1, f2] = bandEdges(17);
  expect(f1 * f2).toBeCloseTo(1000 ** 2, 6);
  expect(bandEdges(18)[0]).toBeCloseTo(f2, 9);
});

test('stereo image of mono, inverted, uncorrelated and one-sided noise', () => {
  const n = noise(1, 0.5, 5);
  let st = measure(n, n);
  expect(st.correlation).toBeCloseTo(1, 9);
  expect(st.width).toBe(0);
  expect(st.monoLossLu).toBe(0);
  expect(st.monoLossBands.every((b) => near(b, 0, 1e-6))).toBe(true);

  st = measure(n, n.map((v) => -v));
  expect(st.correlation).toBeCloseTo(-1, 9);
  expect(st.width).toBe(CAP);
  expect(st.monoLossLu).toBe(CAP);
  expect(st.monoLossBands.every((b) => b === CAP)).toBe(true);

  st = measure(n, noise(2, 0.5, 5));
  expect(near(st.correlation, 0, 0.02)).toBe(true);
  expect(near(st.width, 1, 0.05)).toBe(true);
  expect(near(st.monoLossLu, 3.01, 0.2)).toBe(true);
  // Narrow low bands hold few independent noise samples, so only from 80 Hz
  expect(st.monoLossBands.slice(6).every((b) => near(b, 3.01, 0.5))).toBe(true);

  st = measure(n, new Float32Array(n.length));
  expect(st.correlation).toBe(0);
  expect(st.width).toBeCloseTo(1, 9);
  expect(near(st.monoLossLu, 3.01, 0.2)).toBe(true);
});

// In the version the loudness and true peak come from ffmpeg; here from the meter and the sample peak
const asVersion = (l: Float32Array, r: Float32Array) => {
  const m = measure(l, r);
  const peak = Math.max(...l.map(Math.abs), ...r.map(Math.abs));
  return { measurements: stored(m), integratedLufs: m.integratedLufs, truePeak: db(peak) };
};

test('comparing with a reference matches loudness first', () => {
  const [l, r] = [noise(3, 0.3, 6), noise(4, 0.3, 6)];
  const same = compareMeasurements(asVersion(l, r), asVersion(l, r));
  expect(same).toEqual({ lufsDiff: 0, crestDiffDb: 0, widthDiff: 0, bandDiffDb: Array(31).fill(0) });

  const half = (x: Float32Array) => x.map((v) => v * 0.5);
  const louder = compareMeasurements(asVersion(l, r), asVersion(half(l), half(r)));
  expect(louder.lufsDiff!).toBeCloseTo(6.02, 1);
  expect(louder.crestDiffDb!).toBeCloseTo(0, 1);
  expect(louder.widthDiff).toBeCloseTo(0, 9);
  // Stored bands are rounded to 0.1 dB
  expect(louder.bandDiffDb.every((b) => near(b, 0, 0.15))).toBe(true);

  // A brighter mix shows up in the high bands
  const high = highpass(l, 4000);
  const bright = l.map((v, i) => v + high[i]!);
  const brighter = compareMeasurements(asVersion(bright, r), asVersion(l, r));
  expect(brighter.bandDiffDb[29]!).toBeGreaterThan(brighter.bandDiffDb[10]! + 3);
});

test('a silent reference leaves the bands unmatched and has no loudness difference', () => {
  const n = noise(5, 0.5, 2);
  const silent = { measurements: stored(measure(new Float32Array(100))), integratedLufs: null, truePeak: null };
  const c = compareMeasurements(asVersion(n, n), silent);
  expect(c.lufsDiff).toBeNull();
  expect(c.crestDiffDb).toBeNull();
  expect(c.bandDiffDb[17]).toBe(CAP);
});

const values = (m: Measured) => [...m.bands, m.correlation, m.width, m.monoLossLu, ...m.monoLossBands];

// The values go to the database as JSON, which knows neither NaN nor Infinity
test('no NaN or infinity for silent, short or DC input', () => {
  const inputs = [
    new Float32Array(0),
    Float32Array.of(0.5),
    new Float32Array(secs(2)),
    new Float32Array(secs(2)).fill(0.5),
    new Float32Array(secs(0.1)).fill(0.5),
    sine(1000, 0.5, 0.2),
    noise(5, 1, 0.3),
  ];
  for (const x of inputs) {
    const m = measure(x);
    expect(values(m).every(Number.isFinite)).toBe(true);
    expect(m.bands.every((b) => b >= FLOOR_DB)).toBe(true);
  }
  expect(measure(new Float32Array(secs(2))).bands.every((b) => b === FLOOR_DB)).toBe(true);
});

test('chunks of any size measure the same as the whole input', () => {
  const l = noise(8, 0.4, 3);
  const r = noise(9, 0.4, 3);
  const frames = interleave(l, r);
  const whole = measure(l, r);
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 1, max: 200_000 }), { minLength: 1, maxLength: 8 }), (sizes) => {
      const meter = new Meter(SR);
      let at = 0;
      for (const size of sizes) {
        meter.push(frames.subarray(at, Math.min(frames.length, at + 2 * size)));
        at = Math.min(frames.length, at + 2 * size);
      }
      meter.push(frames.subarray(at));
      expect(meter.result()).toEqual(whole);
    }),
    { numRuns: 10 },
  );
});

const measurements = fc.record({
  bands: fc.array(fc.double({ min: FLOOR_DB, max: 10, noNaN: true }), { minLength: 31, maxLength: 31 }),
  correlation: fc.double({ min: -1, max: 1, noNaN: true }),
  width: fc.double({ min: 0, max: CAP, noNaN: true }),
  monoLossLu: fc.double({ min: -CAP, max: CAP, noNaN: true }),
  monoLossBands: fc.array(fc.double({ min: -CAP, max: CAP, noNaN: true }), { minLength: 31, maxLength: 31 }),
}) satisfies fc.Arbitrary<Measurements>;
const level = fc.option(fc.double({ min: -70, max: 0, noNaN: true }), { nil: null });
const version = fc.record({ measurements, integratedLufs: level, truePeak: level });

test('a version compared with itself shows no difference, swapping turns the signs', () => {
  fc.assert(
    fc.property(version, version, (a, b) => {
      const self = compareMeasurements(a, a);
      expect(self.bandDiffDb.every((d) => d === 0)).toBe(true);
      expect(self.widthDiff).toBe(0);
      const there = compareMeasurements(a, b);
      const back = compareMeasurements(b, a);
      there.bandDiffDb.forEach((d, i) => expect(d + back.bandDiffDb[i]!).toBeCloseTo(0, 9));
      expect(there.widthDiff + back.widthDiff).toBeCloseTo(0, 9);
      expect([...there.bandDiffDb, there.lufsDiff ?? 0, there.crestDiffDb ?? 0, there.widthDiff].every(Number.isFinite)).toBe(true);
    }),
  );
});

test('a minute of stereo measures in a few seconds', () => {
  const frames = interleave(noise(6, 0.3, 60), noise(7, 0.3, 60));
  const start = performance.now();
  const meter = new Meter(SR);
  for (let at = 0; at < frames.length; at += 16_384) meter.push(frames.subarray(at, at + 16_384));
  meter.result();
  expect(performance.now() - start).toBeLessThan(5000);
}, 20_000);

test('the worker script measures PCM from stdin as ffmpeg writes it', async () => {
  const s = sine(1000, 0.5, 2);
  const proc = Bun.spawn([process.execPath, `${import.meta.dir}/services/mix-measurement.ts`], { stdin: interleave(s, s), stdout: 'pipe' });
  const measurements = parseMeasurements(await new Response(proc.stdout).text());
  expect(await proc.exited).toBe(0);
  expect(measurements!.bands[17]!).toBeCloseTo(db(0.5), 0);
  expect(measurements!.correlation).toBe(1);
});

test('unexpected output of the script has no values', () => {
  expect(parseMeasurements('{}')).toBeNull();
  expect(parseMeasurements('not json')).toBeNull();
  expect(parseMeasurements(JSON.stringify({ ...stored(measure(sine(1000, 0.5, 1))), bands: [0] }))).toBeNull();
});

test('the worker keeps partial PCM frames across stdin chunks', async () => {
  const s = sine(1000, 0.5, 1);
  const pcm = new Uint8Array(interleave(s, s).buffer);
  const proc = Bun.spawn([process.execPath, `${import.meta.dir}/services/mix-measurement.ts`], { stdin: 'pipe', stdout: 'pipe' });
  const output = new Response(proc.stdout).text();
  proc.stdin.write(pcm.subarray(0, 3));
  await proc.stdin.flush();
  await Bun.sleep(1000);
  proc.stdin.write(pcm.subarray(3));
  await proc.stdin.end();
  expect(await proc.exited).toBe(0);
  expect(parseMeasurements(await output)).toEqual(parseMeasurements(JSON.stringify(stored(measure(s)))));
});
