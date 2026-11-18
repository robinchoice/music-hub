import { z } from 'zod';
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { projectFiles, versions } from '@music-hub/db';
import { KEY_ROOTS, KEY_SCALES } from '@music-hub/shared';
import { parseMeasuredFile } from '../lib/measure.js';
import { putObject, createDownloadUrl } from '../storage/s3.js';
import { hasWaitingAudioJob } from './audio-jobs.js';
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

  // Errors go to the worker, which tries again (services/audio-jobs.ts)
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

  signal.throwIfAborted();
  console.log(`[Worker] Version ${versionId} ready`);

  await db
    .update(versions)
    .set({ status: sql`case when ${versions.status} in ('uploaded', 'processing') then 'ready'::version_status else ${versions.status} end` })
    .where(eq(versions.id, versionId));

  // Lets open track pages switch to the MP3 and the waveform
  publish(db, version.trackId, { type: 'version:status', data: { versionId, status: 'ready' } });
}

// What the worker does when no version waits for its MP3, one version at a time: the newest playable version
// without it, which also catches up on versions from before it. A version is marked in `mark` when taken, so
// one that keeps failing doesn't come back. A new upload goes first: the work stops, and the version comes back
// once the worker is idle again.
async function idleWork(
  db: Database,
  stop: AbortSignal,
  mark: 'analyzedAt' | 'measuredAt',
  work: (url: string, signal: AbortSignal) => Promise<Partial<typeof versions.$inferInsert> | null>,
): Promise<boolean> {
  const next = db
    .select({ id: versions.id })
    .from(versions)
    .where(and(isNull(versions[mark]), isNull(versions.deletedAt), notInArray(versions.status, ['uploaded', 'processing'])))
    .orderBy(desc(versions.createdAt))
    .limit(1)
    .for('update', { skipLocked: true });
  const claimedAt = new Date();
  const [version] = await db
    .update(versions)
    .set({ [mark]: claimedAt })
    .where(inArray(versions.id, next))
    .returning({ id: versions.id, trackId: versions.trackId, originalFileKey: versions.originalFileKey });
  if (!version) return false;
  // A correction by hand sets analyzed_at anew while the analysis runs, and then wins
  const stillOurs = and(eq(versions.id, version.id), eq(versions[mark], claimedAt));

  await yieldingToUploads(db, stop, async (signal) => {
    const values = await work(await createDownloadUrl(version.originalFileKey, 3600), signal);
    if (!values) return;
    const [stored] = await db.update(versions).set(values).where(stillOurs).returning({ id: versions.id });
    if (stored) publish(db, version.trackId, { type: 'version:details', data: { versionId: version.id } });
  }, () => db.update(versions).set({ [mark]: null }).where(stillOurs));
  return true;
}

// Idle work gives way to uploads: a waiting audio job stops it (checked every 2 seconds), and `release`
// hands the claim back, so it comes again once the worker is idle. A shutdown does the same and throws.
async function yieldingToUploads(
  db: Database,
  stop: AbortSignal,
  work: (signal: AbortSignal) => Promise<void>,
  release: () => Promise<unknown>,
) {
  const upload = new AbortController();
  const signal = AbortSignal.any([stop, upload.signal]);
  const watch = setInterval(() => {
    hasWaitingAudioJob(db).then((waiting) => waiting && upload.abort(), () => {});
  }, 2000);
  try {
    await work(signal);
  } catch (error) {
    if (!signal.aborted) throw error;
    await release();
    if (stop.aborted) throw error;
  } finally {
    clearInterval(watch);
  }
}

// Tempo and key take longest, so the worker only works on them when idle
export const analyzeNextVersion = (db: Database, stop: AbortSignal) => idleWork(db, stop, 'analyzedAt', analyzeMusic);

// Spectrum and stereo image for the version page, the same way
export const measureNextVersion = (db: Database, stop: AbortSignal) =>
  idleWork(db, stop, 'measuredAt', async (url, signal) => {
    const measured = await measureMix(url, signal);
    return measured && { measurements: measured.measurements };
  });

// A file marked as the reference track of its project, measured like a version and with its own loudness, which
// ffmpeg only measures for versions. Marked when taken like the versions; a new upload goes first.
export async function measureNextReference(db: Database, stop: AbortSignal): Promise<boolean> {
  const claimedAt = new Date();
  const next = db
    .select({ id: projectFiles.id })
    .from(projectFiles)
    .where(and(eq(projectFiles.reference, true), isNull(projectFiles.measuredAt), isNull(projectFiles.deletedAt)))
    .limit(1)
    .for('update', { skipLocked: true });
  const [file] = await db
    .update(projectFiles)
    .set({ measuredAt: claimedAt })
    .where(inArray(projectFiles.id, next))
    .returning({ id: projectFiles.id, projectId: projectFiles.projectId, fileKey: projectFiles.fileKey });
  if (!file) return false;
  const stillOurs = and(eq(projectFiles.id, file.id), eq(projectFiles.measuredAt, claimedAt));

  await yieldingToUploads(db, stop, async (signal) => {
    const measured = await measureMix(await createDownloadUrl(file.fileKey, 3600), signal);
    if (measured) await db.update(projectFiles).set(measured).where(stillOurs);
  }, () => db.update(projectFiles).set({ measuredAt: null }).where(stillOurs));
  return true;
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

const NO_LOUDNESS = { integratedLufs: null, loudnessRange: null, truePeak: null };

async function measureLoudness(url: string, signal: AbortSignal) {
  signal.throwIfAborted();
  // The summary on stderr rounds the true peak to 0.1 dB, so it comes from the frame metadata on stdout
  const proc = Bun.spawn(['ffmpeg', '-nostats', '-i', url, '-af', 'ebur128=peak=true:metadata=1,ametadata=mode=print:file=-', '-f', 'null', '-'], {
    stdout: 'pipe',
    stderr: 'pipe',
    ...FFMPEG_LIMITS, signal,
  });

  const [log, frames] = await Promise.all([new Response(proc.stderr).text(), new Response(proc.stdout).text()]);
  return await proc.exited === 0 ? parseLoudness(log, frames) : NO_LOUDNESS;
}

// EBU R128 integrated loudness in LUFS and loudness range in LU from the ebur128 summary, true peak
// in dBTP from the frame metadata. ffmpeg reports -70 LUFS for silence, which is "nothing to match",
// so that becomes null.
export function parseLoudness(log: string, frames: string): { integratedLufs: number | null; loudnessRange: number | null; truePeak: number | null } {
  // Per-frame lines carry the running values; the summary at the end is the last match
  const last = (re: RegExp) => [...log.matchAll(re)].at(-1)?.[1];
  const integrated = last(/\bI:\s+(-?[\d.]+) LUFS/g);
  if (integrated === undefined || parseFloat(integrated) <= -70) return NO_LOUDNESS;
  const range = last(/\bLRA:\s+([\d.]+) LU\b/g);
  // Linear true peak per channel; the highest of all frames and channels is the true peak of the file
  const peak = Math.max(0, ...[...frames.matchAll(/^lavfi\.r128\.true_peaks_ch\d+=([\d.]+)$/gm)].map((m) => parseFloat(m[1])));
  return {
    integratedLufs: parseFloat(integrated),
    loudnessRange: range === undefined ? null : parseFloat(range),
    truePeak: peak > 0 ? Math.round(2000 * Math.log10(peak)) / 100 : null,
  };
}

const ANALYSIS_SCRIPT = `${import.meta.dir}/music-analysis.ts`;
const MEASUREMENT_SCRIPT = `${import.meta.dir}/mix-measurement.ts`;

// ffmpeg decodes the first ten minutes to raw float samples and streams them into `script`, which runs in
// its own process with low priority, so it gives way to everything else on VPS 1. Ten minutes are plenty
// and keep a long DJ mix from filling the memory. Returns what the script printed, null when either failed.
async function decodeInto(script: string, name: string, url: string, layout: { channels: number; rate: number }, signal: AbortSignal) {
  signal.throwIfAborted();
  const decode = Bun.spawn(
    ['ffmpeg', '-v', 'quiet', '-i', url, '-t', '600', '-ac', String(layout.channels), '-ar', String(layout.rate), '-f', 'f32le', 'pipe:1'],
    { ...FFMPEG_LIMITS, signal },
  );
  const child = Bun.spawn(['nice', '-n', '10', process.execPath, script], { stdin: decode.stdout, stderr: 'pipe', ...FFMPEG_LIMITS, signal });
  const [output, log] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const [decoded, finished] = await Promise.all([decode.exited, child.exited]);
  signal.throwIfAborted();
  if (decoded !== 0 || finished !== 0) {
    console.error(`[Worker] ${name} failed: ${decoded !== 0 ? 'ffmpeg could not read the file' : log.trim().split('\n').at(-1)}`);
    return null;
  }
  return output;
}

// Tempo and key from a mono signal, as Essentia expects it
async function analyzeMusic(url: string, signal: AbortSignal) {
  const output = await decodeInto(ANALYSIS_SCRIPT, 'Music analysis', url, { channels: 1, rate: 44100 }, signal);
  return output === null ? null : parseMusicAnalysis(output);
}

// Spectrum and stereo image in stereo at 48 kHz
async function measureMix(url: string, signal: AbortSignal) {
  const output = await decodeInto(MEASUREMENT_SCRIPT, 'Mix measurement', url, { channels: 2, rate: 48000 }, signal);
  return output === null ? null : parseMeasuredFile(output);
}

// Keeps what Essentia is sure enough about. Its tempo confidence runs from 0 to 5.32, below 1 the beat
// is a guess; silence comes out as a confident 738 BPM, hence the range. A key strength below 0.5 means
// no key stood out.
export function parseMusicAnalysis(output: string): { bpm: number | null; keyRoot: string | null; keyScale: string | null } | null {
  const parsed = z.object({
    bpm: z.number(),
    bpmConfidence: z.number(),
    key: z.enum(KEY_ROOTS),
    scale: z.enum(KEY_SCALES),
    keyStrength: z.number(),
  }).safeParse(JSON.parse(output));
  if (!parsed.success) return null;
  const result = parsed.data;
  const sureOfTempo = result.bpmConfidence >= 1 && result.bpm >= 40 && result.bpm <= 250;
  const sureOfKey = result.keyStrength >= 0.5;
  return {
    bpm: sureOfTempo ? Math.round(result.bpm * 10) / 10 : null,
    keyRoot: sureOfKey ? result.key : null,
    keyScale: sureOfKey ? result.scale : null,
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
