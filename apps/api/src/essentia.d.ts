// essentia.js ships types only for its core API, and those take `any`; this covers what music-analysis.ts uses.
// The results are checked with zod in audio-processor.ts.
declare module 'essentia.js/dist/essentia-wasm.umd.js' {
  const EssentiaWASM: unknown;
  export default EssentiaWASM;
}

declare module 'essentia.js/dist/essentia.js-core.umd.js' {
  type Vector = { readonly __vector: unique symbol };
  export default class Essentia {
    constructor(wasm: unknown);
    arrayToVector(input: Float32Array): Vector;
    RhythmExtractor2013(signal: Vector, maxTempo: number, method: string, minTempo: number): { bpm: unknown; confidence: unknown };
    KeyExtractor(audio: Vector): { key: unknown; scale: unknown; strength: unknown };
  }
}
