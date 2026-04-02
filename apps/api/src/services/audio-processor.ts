import { eq } from 'drizzle-orm';
import { versions } from '@music-hub/db';
import { createUploadUrl, createDownloadUrl } from '../storage/s3.js';
import type { Database } from '@music-hub/db';

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

    // Generate waveform peaks
    const peaks = await generateWaveformPeaks(originalUrl, metadata.duration);
    const waveformKey = version.originalFileKey.replace(/\/original\/.*$/, '/waveform/peaks.json');

    // Upload waveform data to S3
    const waveformUploadUrl = await createUploadUrl(waveformKey, 'application/json', 10 * 1024 * 1024);
    await fetch(waveformUploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(peaks),
    });

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
  ]);

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  const data = JSON.parse(output);
  const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');

  return {
    duration: parseFloat(data.format?.duration || '0'),
    sampleRate: parseInt(audioStream?.sample_rate || '44100'),
    bitDepth: parseInt(audioStream?.bits_per_raw_sample || audioStream?.bits_per_sample || '16'),
  };
}

async function generateWaveformPeaks(url: string, duration: number): Promise<number[]> {
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
  ]);

  const buffer = await new Response(proc.stdout).arrayBuffer();
  await proc.exited;

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

  const proc = Bun.spawn([
    'ffmpeg',
    '-i', inputUrl,
    '-codec:a', 'libmp3lame',
    '-b:a', '128k',
    '-v', 'quiet',
    '-y',
    tmpFile,
  ]);

  await proc.exited;

  // Upload to S3
  const file = Bun.file(tmpFile);
  const fileSize = file.size;
  const uploadUrl = await createUploadUrl(outputKey, 'audio/mpeg', fileSize);

  await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/mpeg' },
    body: file,
  });

  // Cleanup
  await Bun.file(tmpFile).exists() && (await Bun.spawn(['rm', tmpFile]).exited);
}
