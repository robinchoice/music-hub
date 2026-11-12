// Measurements of a mix beyond loudness, taken by the audio worker (apps/api/src/lib/measure.ts) and
// compared here, so the web and the CLI read them alike. Ported from pinna-analysis (Pinna, by Robin,
// MIT OR Apache-2.0). Levels are dB. No value is ever NaN or infinite: silent bands read FLOOR_DB, ratios
// and differences that would diverge are capped at ±CAP.
import { z } from 'zod';

/** Centre frequencies of the 31 third-octave bands from 20 Hz to 20 kHz (IEC 61260) */
export const THIRD_OCTAVE_HZ = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
  6300, 8000, 10_000, 12_500, 16_000, 20_000,
] as const;

/** Level of a silent band, dB */
export const FLOOR_DB = -150;

/** Cap for ratios and differences that diverge (mono loss of L = -R, width of a pure side signal), dB, LU or plain ratio */
export const CAP = 99;

const bands = z.array(z.number()).length(THIRD_OCTAVE_HZ.length);

export const measurementsSchema = z.object({
  /** Long-term level per third-octave band, dB: a full-scale sine at a band centre on both channels reads 0 */
  bands,
  /** As a phase correlation meter shows it, -1 to 1; 1 for silence, 0 when one channel is silent */
  correlation: z.number(),
  /** Side energy over mid energy: 0 for mono, 1 for uncorrelated or one-sided channels, CAP for pure side */
  width: z.number(),
  /** Integrated loudness lost when folded to mono, LU */
  monoLossLu: z.number(),
  /** Per band, dB: 0 for silent bands, CAP where the fold cancels the band */
  monoLossBands: bands,
});

export type Measurements = z.infer<typeof measurementsSchema>;

type Measured = { measurements: Measurements; integratedLufs: number | null; truePeak: number | null };

export type Comparison = {
  /** Mix minus reference, LU; null where either has no loudness (silence) */
  lufsDiff: number | null;
  /** Per band after matching both to the same integrated loudness, mix minus reference, dB; 0 for bands silent in both */
  bandDiffDb: number[];
  /** Crest factor (true peak minus integrated loudness), mix minus reference, dB */
  crestDiffDb: number | null;
  /** Width, mix minus reference */
  widthDiff: number;
};

const capped = (x: number) => Math.min(CAP, Math.max(-CAP, x));

/** Gain in dB that brings the loudness of b to that of a; 0 where either has none */
export function matchGainDb(a: number | null, b: number | null): number {
  return a === null || b === null ? 0 : capped(a - b);
}

// What changed from the reference to the mix, heard at the same loudness: the reference is usually the
// previous version, so a brighter mix shows in the high bands, not as a louder one
export function compareMeasurements(mix: Measured, reference: Measured): Comparison {
  const gain = matchGainDb(mix.integratedLufs, reference.integratedLufs);
  const crest = (m: Measured) => (m.truePeak === null || m.integratedLufs === null ? null : m.truePeak - m.integratedLufs);
  const [crestMix, crestReference] = [crest(mix), crest(reference)];
  return {
    lufsDiff: mix.integratedLufs === null || reference.integratedLufs === null ? null : gain,
    bandDiffDb: mix.measurements.bands.map((m, i) => {
      const r = reference.measurements.bands[i]!;
      return m === FLOOR_DB && r === FLOOR_DB ? 0 : capped(m - r - gain);
    }),
    crestDiffDb: crestMix === null || crestReference === null ? null : capped(crestMix - crestReference),
    widthDiff: mix.measurements.width - reference.measurements.width,
  };
}
