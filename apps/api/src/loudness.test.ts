import { expect, test } from 'bun:test';
import { parseLoudness } from './services/audio-processor.js';

// Shortened output of `ffmpeg -nostats -i … -af ebur128=peak=true:metadata=1,ametadata=mode=print:file=- -f null -`
// (ffmpeg 6.1): the log on stderr, the frame metadata on stdout
const frame = (i: number, lra: string) =>
  `[Parsed_ebur128_0 @ 0x58a8ddfed480] t: 5.99998    TARGET:-23 LUFS    M: -14.1 S: -14.3     I: ${i} LUFS       LRA:   ${lra} LU  FTPK: -2.0 -2.1 dBFS  TPK: -1.0 -1.0 dBFS`;
const summary = (i: string, lra: string, peak: string) => `[Parsed_ebur128_0 @ 0x58a8ddfed480] Summary:

  Integrated loudness:
    I:         ${i} LUFS
    Threshold: -26.0 LUFS

  Loudness range:
    LRA:         ${lra} LU
    Threshold: -36.1 LUFS
    LRA low:   -19.7 LUFS
    LRA high:  -14.5 LUFS

  True peak:
    Peak:       ${peak} dBFS
`;
const metadata = (pts: number, ch0: string, ch1: string) => `frame:${pts}    pts:${pts * 4800}  pts_time:${pts / 10}
lavfi.r128.M=-14.100
lavfi.r128.true_peaks_ch0=${ch0}
lavfi.r128.true_peaks_ch1=${ch1}
lavfi.r128.true_peaks_per_frame_ch0=1.200
`;

test('reads integrated loudness and range from the summary, the true peak from the frames', () => {
  const log = [frame(-15.1, '4.0'), frame(-15.4, '5.0'), summary('-15.9', '10.1', '-1.0')].join('\n');
  // 0.8954 is −0.96 dBTP, which the summary rounds to −1.0
  const frames = metadata(1, '0.500', '0.700') + metadata(2, '0.600', '0.8954');
  expect(parseLoudness(log, frames)).toEqual({ integratedLufs: -15.9, loudnessRange: 10.1, truePeak: -0.96 });
});

test('silence has nothing to match or show', () => {
  expect(parseLoudness(summary('-70.0', '0.0', '-inf'), metadata(1, '0.000', '0.000'))).toEqual({ integratedLufs: null, loudnessRange: null, truePeak: null });
});

test('a failed run has no values', () => {
  expect(parseLoudness('', '')).toEqual({ integratedLufs: null, loudnessRange: null, truePeak: null });
});
