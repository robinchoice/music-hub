import { eq } from 'drizzle-orm';
import { versions } from '@music-hub/db';
import { putObject, createDownloadUrl } from '../storage/s3.js';
import { publish } from './sse.js';
import type { Database } from '@music-hub/db';

const FFMPEG_LIMITS = { timeout: 15 * 60_000, killSignal: 'SIGKILL' } as const;

// Runs in the worker, one version at a time (services/audio-jobs.ts)
export async function processVersion(db: Database, versionId: string) {
  console.log(`[Worker] Processing version ${versionId}`);

  // Mark as processing
  const [version] = await db
    .update(versions)
    .set({ status: 'processing' })
    .where(eq(versions.id, versionId))
    .returning();

  if (!version) {
    console.error(`[Worker] Version ${versionId} not found`);
    return;
  }

  try {
    const originalUrl = await createDownloadUrl(version.originalFileKey, 3600);

    // Extract metadata with ffprobe
    const metadata = await extractMetadata(originalUrl);

    // Integrated loudness, so the DAW plugin can level-match versions
    const integratedLufs = await measureLoudness(originalUrl);

    // Generate waveform peaks
    const peaks = await generateWaveformPeaks(originalUrl, metadata.duration);
    const waveformKey = peaks
      ? version.originalFileKey.replace(/\/original\/.*$/, '/waveform/peaks.json')
      : null;

    // Upload waveform data to S3
    if (waveformKey) await putObject(waveformKey, JSON.stringify(peaks), 'application/json');

    // Transcode to MP3 for streaming
    const streamKey = version.originalFileKey.replace(/\/original\/.*$/, '/stream/audio.mp3');
    await transcodeToMp3(originalUrl, streamKey);

    // Update version with metadata
    await db
      .update(versions)
      .set({
        status: 'ready',
        duration: metadata.duration,
        sampleRate: metadata.sampleRate,
        bitDepth: metadata.bitDepth,
        integratedLufs,
        streamFileKey: streamKey,
        waveformDataKey: waveformKey,
      })
      .where(eq(versions.id, versionId));

    console.log(`[Worker] Version ${versionId} ready`);
  } catch (error) {
    console.error(`[Worker] Failed to process version ${versionId}:`, error);
    // Still mark as ready so user can listen to original
    await db
      .update(versions)
      .set({ status: 'ready' })
      .where(eq(versions.id, versionId));
  }

  // Lets open track pages switch to the MP3 and the waveform
  publish(db, version.trackId, { type: 'version:status', data: { versionId, status: 'ready' } });
}

async function extractMetadata(url: string): Promise<{
  duration: number;
  sampleRate: number;
  bitDepth: number;
}> {
  const proc = Bun.spawn([
    'ffprobe',
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    url,
  ], FFMPEG_LIMITS);

  const output = await new Response(proc.stdout).text();
  if (await proc.exited !== 0) throw new Error('Audio processing failed or timed out');

  const data = JSON.parse(output);
  const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');

  return {
    duration: parseFloat(data.format?.duration || '0'),
    sampleRate: parseInt(audioStream?.sample_rate || '44100'),
    bitDepth: parseInt(audioStream?.bits_per_raw_sample || audioStream?.bits_per_sample || '16'),
  };
}

// EBU R128 integrated loudness in LUFS. ffmpeg reports -70 for silence,
// which is "nothing to match", so that becomes null.
async function measureLoudness(url: string): Promise<number | null> {
  const proc = Bun.spawn(['ffmpeg', '-nostats', '-i', url, '-af', 'ebur128', '-f', 'null', '-'], {
    stdout: 'ignore',
    stderr: 'pipe',
    ...FFMPEG_LIMITS,
  });

  const log = await new Response(proc.stderr).text();
  if (await proc.exited !== 0) return null;

  // Per-second lines carry the running value; the summary at the end is the last match
  const last = [...log.matchAll(/\bI:\s+(-?[\d.]+) LUFS/g)].at(-1);
  if (!last) return null;
  const lufs = parseFloat(last[1]);
  return lufs <= -70 ? null : lufs;
}

async function generateWaveformPeaks(url: string, duration: number): Promise<number[] | null> {
  // Generate raw PCM samples with ffmpeg, then compute peaks
  const samplesPerPixel = Math.max(1, Math.floor(duration * 44100 / 800)); // ~800 peaks

  const proc = Bun.spawn([
    'ffmpeg',
    '-i', url,
    '-ac', '1',           // mono
    '-ar', '8000',         // low sample rate for peaks
    '-f', 'f32le',         // raw 32-bit float
    '-v', 'quiet',
    'pipe:1',
  ], FFMPEG_LIMITS);

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

async function transcodeToMp3(inputUrl: string, outputKey: string) {
  // Transcode to temp file, then upload
  const tmpFile = `/tmp/musichub-${crypto.randomUUID()}.mp3`;

  let mp3;
  try {
    const proc = Bun.spawn([
      'ffmpeg',
      '-i', inputUrl,
      '-codec:a', 'libmp3lame',
      '-b:a', '128k',
      '-v', 'quiet',
      '-y',
      tmpFile,
    ], FFMPEG_LIMITS);

    if (await proc.exited !== 0) throw new Error('Audio processing failed or timed out');

    mp3 = await Bun.file(tmpFile).bytes();
  } finally {
    await Bun.file(tmpFile).delete().catch(() => {});
  }

  await putObject(outputKey, mp3, 'audio/mpeg');
}
