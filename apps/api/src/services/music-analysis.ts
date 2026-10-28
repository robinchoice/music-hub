// Tempo and key of a mix with Essentia (essentia.js, WebAssembly), started by the worker as its own process
// (audio-processor.ts) so the long, blocking calculation can't stall the worker and dies with a kill.
// Reads mono 32-bit float PCM at 44.1 kHz on stdin, as ffmpeg writes it, and prints one line of JSON.
import EssentiaWASM from 'essentia.js/dist/essentia-wasm.umd.js';
import Essentia from 'essentia.js/dist/essentia.js-core.umd.js';

const audio = new Float32Array(await Bun.stdin.arrayBuffer());
const essentia = new Essentia(EssentiaWASM);
const signal = essentia.arrayToVector(audio);
const rhythm = essentia.RhythmExtractor2013(signal, 208, 'multifeature', 40);
// The default bgate profile, made for popular music
const key = essentia.KeyExtractor(signal);
console.log(JSON.stringify({ bpm: rhythm.bpm, bpmConfidence: rhythm.confidence, key: key.key, scale: key.scale, keyStrength: key.strength }));
