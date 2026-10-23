import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { versions } from '@music-hub/db';
import { putObject, createDownloadUrl } from '../storage/s3.js';
import { publish } from './sse.js';
import type { Database } from '@music-hub/db';

const FFMPEG_LIMITS = { timeout: 15 * 60_000, killSignal: 'SIGKILL' } as const;

// Runs in the worker, one version at a time (services/audio-jobs.ts)
export async function processVersion(db: Database, versionId: string, signal: AbortSignal) {
  console.log(`[Worker] Processing version ${versionId}`);

  // Mark as processing
  const [version] = await db
    .update(versions)
    .set({ status: sql`case when ${versions.status} in ('uploaded', 'processing') then 'processing'::version_status else ${versions.status} end` })
    .where(eq(versions.id, versionId))
    .returning();

  if (!version) {
    console.error(`[Worker] Version ${versionId} not found`);
    return;
  }

  try {
    const originalUrl = await createDownloadUrl(version.originalFileKey, 3600);

    // Extract metadata with ffprobe
    const metadata = await extractMetadata(originalUrl, signal);

    // Integrated loudness, so the DAW plugin can level-match versions, plus true peak and range for the file details
    const loudness = await measureLoudness(originalUrl, signal);

    // Generate waveform peaks
    const peaks = await generateWaveformPeaks(originalUrl, metadata.duration, signal);
    const waveformKey = peaks
      ? version.originalFileKey.replace(/\/original\/.*$/, '/waveform/peaks.json')
      : null;

    // Upload waveform data to S3
    if (waveformKey) await putObject(waveformKey, JSON.stringify(peaks), 'application/json');

    // Transcode to MP3 for streaming
    const streamKey = version.originalFileKey.replace(/\/original\/.*$/, '/stream/audio.mp3');
    await transcodeToMp3(originalUrl, streamKey, signal);

    // Update version with metadata
    await db
      .update(versions)
      .set({
        duration: metadata.duration,
        sampleRate: metadata.sampleRate,
        bitDepth: metadata.bitDepth,
        sampleFormat: metadata.sampleFormat,
        ...loudness,
        streamFileKey: streamKey,
        waveformDataKey: waveformKey,
      })
      .where(eq(versions.id, versionId));

    console.log(`[Worker] Version ${versionId} ready`);
    signal.throwIfAborted();
  } catch (error) {
    signal.throwIfAborted();
    console.error(`[Worker] Failed to process version ${versionId}:`, error);
  }

  await db
    .update(versions)
    .set({ status: sql`case when ${versions.status} in ('uploaded', 'processing') then 'ready'::version_status else ${versions.status} end` })
    .where(eq(versions.id, versionId));

  // Lets open track pages switch to the MP3 and the waveform
  publish(db, version.trackId, { type: 'version:status', data: { versionId, status: 'ready' } });
}

async function extractMetadata(url: string, signal: AbortSignal): Promise<{
  duration: number;
  sampleRate: number;
  bitDepth: number;
  sampleFormat: string | null;
}> {
  signal.throwIfAborted();
  const proc = Bun.spawn([
    'ffprobe',
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    url,
  ], { ...FFMPEG_LIMITS, signal });

  const output = await new Response(proc.stdout).text();
  if (await proc.exited !== 0) throw new Error('Audio processing failed or timed out');

  const data = z.object({
    streams: z.array(z.object({ codec_type: z.string().optional(), sample_rate: z.string().optional(), bits_per_raw_sample: z.string().optional(), bits_per_sample: z.number().optional(), sample_fmt: z.string().optional() })).optional(),
    format: z.object({ duration: z.string().optional() }).optional(),
  }).parse(JSON.parse(output));
  const audioStream = data.streams?.find((s) => s.codec_type === 'audio');

  return {
    duration: parseFloat(data.format?.duration || '0'),
    sampleRate: parseInt(audioStream?.sample_rate || '44100'),
    bitDepth: parseInt(audioStream?.bits_per_raw_sample || String(audioStream?.bits_per_sample || 16)),
    // "flt" or "dbl" (planar "fltp") tells 32-bit float from 32-bit integer
    sampleFormat: audioStream?.sample_fmt ?? null,
  };
}

async function measureLoudness(url: string, signal: AbortSignal) {
  signal.throwIfAborted();
  // The summary on stderr rounds the true peak to 0.1 dB, so it comes from the frame metadata on stdout
  const proc = Bun.spawn(['ffmpeg', '-nostats', '-i', url, '-af', 'ebur128=peak=true:metadata=1,ametadata=mode=print:file=-', '-f', 'null', '-'], {
    stdout: 'pipe',
    stderr: 'pipe',
    ...FFMPEG_LIMITS, signal,
  });

  const [log, frames] = await Promise.all([new Response(proc.stderr).text(), new Response(proc.stdout).text()]);
  return await proc.exited === 0 ? parseLoudness(log, frames) : parseLoudness('', '');
}

// EBU R128 integrated loudness in LUFS and loudness range in LU from the ebur128 summary, true peak
// in dBTP from the frame metadata. ffmpeg reports -70 LUFS for silence, which is "nothing to match",
// so that becomes null.
export function parseLoudness(log: string, frames: string): { integratedLufs: number | null; loudnessRange: number | null; truePeak: number | null } {
  // Per-frame lines carry the running values; the summary at the end is the last match
  const last = (re: RegExp) => [...log.matchAll(re)].at(-1)?.[1];
  const integrated = last(/\bI:\s+(-?[\d.]+) LUFS/g);
  if (integrated === undefined || parseFloat(integrated) <= -70) return { integratedLufs: null, loudnessRange: null, truePeak: null };
  const range = last(/\bLRA:\s+([\d.]+) LU\b/g);
  // Linear true peak per channel; the highest of all frames and channels is the true peak of the file
  const peak = Math.max(0, ...[...frames.matchAll(/^lavfi\.r128\.true_peaks_ch\d+=([\d.]+)$/gm)].map((m) => parseFloat(m[1])));
  return {
    integratedLufs: parseFloat(integrated),
    loudnessRange: range === undefined ? null : parseFloat(range),
    truePeak: peak > 0 ? Math.round(2000 * Math.log10(peak)) / 100 : null,
  };
}

async function generateWaveformPeaks(url: string, duration: number, signal: AbortSignal): Promise<number[] | null> {
  // Generate raw PCM samples with ffmpeg, then compute peaks
  const samplesPerPixel = Math.max(1, Math.floor(duration * 44100 / 800)); // ~800 peaks

  signal.throwIfAborted();
  const proc = Bun.spawn([
    'ffmpeg',
    '-i', url,
    '-ac', '1',           // mono
    '-ar', '8000',         // low sample rate for peaks
    '-f', 'f32le',         // raw 32-bit float
    '-v', 'quiet',
    'pipe:1',
  ], { ...FFMPEG_LIMITS, signal });

  const buffer = await new Response(proc.stdout).arrayBuffer();
  if (await proc.exited !== 0) return null;

  const samples = new Float32Array(buffer);
  const numPeaks = 800;
  const blockSize = Math.max(1, Math.floor(samples.length / numPeaks));
  const peaks: number[] = [];

  for (let i = 0; i < numPeaks && i * blockSize < samples.length; i++) {
    let max = 0;
    const start = i * blockSize;
    const end = Math.min(start + blockSize, samples.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(samples[j]);
      if (abs > max) max = abs;
    }
    peaks.push(Math.round(max * 1000) / 1000);
  }

  return peaks;
}

async function transcodeToMp3(inputUrl: string, outputKey: string, signal: AbortSignal) {
  // Transcode to temp file, then upload
  const tmpFile = `/tmp/musichub-${crypto.randomUUID()}.mp3`;

  let mp3: Uint8Array;
  try {
    signal.throwIfAborted();
    const proc = Bun.spawn([
      'ffmpeg',
      '-i', inputUrl,
      '-codec:a', 'libmp3lame',
      '-b:a', '128k',
      '-v', 'quiet',
      '-y',
      tmpFile,
    ], { ...FFMPEG_LIMITS, signal });

    if (await proc.exited !== 0) throw new Error('Audio processing failed or timed out');

    mp3 = await Bun.file(tmpFile).bytes();
  } finally {
    await Bun.file(tmpFile).delete().catch(() => {});
  }

  await putObject(outputKey, mp3, 'audio/mpeg');
}
