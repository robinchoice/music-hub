// Third-octave spectrum and stereo image of a mix (lib/measure.ts), started by the worker as its own process
// like music-analysis.ts. Reads stereo 32-bit float PCM at 48 kHz on stdin as ffmpeg writes it, block by block,
// and prints one line of JSON: the measurements and the integrated loudness.
import { Meter, stored } from '../lib/measure.js';

const meter = new Meter(48_000);
let rest = new Uint8Array(0);
for await (const chunk of Bun.stdin.stream()) {
  const bytes = rest.length ? Buffer.concat([rest, chunk]) : chunk;
  // A chunk may end within a frame; copy even when concat returned a Buffer with a shared backing store
  const whole = bytes.length - (bytes.length % 8);
  meter.push(new Float32Array(Uint8Array.from(bytes.subarray(0, whole)).buffer));
  rest = bytes.slice(whole);
}
const result = meter.result();
// The loudness is for a reference track, which ffmpeg doesn't measure; null for silence
const integratedLufs = Number.isFinite(result.integratedLufs) ? Math.round(result.integratedLufs * 100) / 100 : null;
console.log(JSON.stringify({ ...stored(result), integratedLufs }));
