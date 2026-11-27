import { crc32 } from 'node:zlib';
import { Zip, ZipPassThrough } from 'fflate';
import { getObjectStream } from '../storage/s3.js';
import { liveSetFile, probeAudio, type LiveSet, type LiveSetClip } from './ableton.js';

type ZipEntry = { name: string; data: AsyncIterable<Uint8Array> | Iterable<Uint8Array> };
type StemFile = { originalFileName: string; fileKey: string };

// Enough of the head of a file to find its format chunk, even behind large metadata chunks
const HEAD_BYTES = 1024 * 1024;

// The stems of a track as an uncompressed ZIP
export function zipResponse(trackName: string, files: StemFile[]) {
  async function* entries() {
    const names = new Set<string>();
    for (const file of files) yield { name: uniqueName(file.originalFileName, names), data: await getObjectStream(file.fileKey) };
  }
  return download(`${slug(trackName)}-stems.zip`, zipEntries(entries()));
}

// An Ableton project folder: the stems under Samples/Imported and a set with one track per stem, all from bar 1.
// The set comes last in the ZIP, after each stem has streamed past for its length and checksum.
export function abletonResponse(trackName: string, files: (StemFile & { name: string })[], set: Omit<LiveSet, 'clips'>) {
  const name = trackName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'Track';
  const project = `${name} Project`;
  async function* entries(): AsyncGenerator<ZipEntry> {
    const names = new Set<string>();
    const clips: LiveSetClip[] = [];
    // Live recognises a project folder by this folder
    yield { name: `${project}/Ableton Project Info/`, data: [] };
    for (const file of files) {
      const path = `Samples/Imported/${uniqueName(file.originalFileName, names)}`;
      const seen = { size: 0, crc: 0, head: [] as Uint8Array[], headSize: 0 };
      yield { name: `${project}/${path}`, data: watch(await getObjectStream(file.fileKey), seen) };
      const head = new Uint8Array(seen.headSize);
      seen.head.reduce((at, chunk) => (head.set(chunk, at), at + chunk.length), 0);
      const info = probeAudio(head, seen.size);
      // A file whose length can't be read stays in the folder without a track
      if (info) clips.push({ name: file.name, path, size: seen.size, crc: seen.crc, info });
    }
    yield { name: `${project}/${name}.als`, data: [liveSetFile({ ...set, clips })] };
  }
  return download(`${slug(trackName)}-ableton.zip`, zipEntries(entries()));
}

async function* watch(stream: AsyncIterable<Uint8Array>, seen: { size: number; crc: number; head: Uint8Array[]; headSize: number }) {
  for await (const chunk of stream) {
    seen.size += chunk.length;
    seen.crc = crc32(chunk, seen.crc);
    if (seen.headSize < HEAD_BYTES) {
      const part = chunk.subarray(0, HEAD_BYTES - seen.headSize);
      seen.head.push(part.slice());
      seen.headSize += part.length;
    }
    yield chunk;
  }
}

// Pulls the next chunk only once the client has taken the last one
function download(fileName: string, chunks: AsyncGenerator<Uint8Array, void>) {
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await chunks.return();
    },
  });
  return new Response(body, {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${fileName}"` },
  });
}

// Streams one entry after the other into the uncompressed ZIP, so memory holds a few chunks however large the files are
async function* zipEntries(entries: AsyncIterable<ZipEntry>) {
  const out: Uint8Array[] = [];
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    out.push(chunk);
  });
  for await (const entry of entries) {
    const file = new ZipPassThrough(entry.name);
    zip.add(file);
    for await (const data of entry.data) {
      file.push(data);
      yield* out.splice(0);
    }
    file.push(new Uint8Array(0), true);
  }
  zip.end();
  yield* out.splice(0);
}

const slug = (name: string) => name.replace(/[^a-z0-9]/gi, '-').toLowerCase();

// Plain, distinct file names: unpacking would otherwise create folders or overwrite
// files of the same name
function uniqueName(fileName: string, taken: Set<string>): string {
  const base = fileName.replace(/[\\/]/g, '_');
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = base.replace(/(\.[^.]*)?$/, ` (${n})$1`);
  taken.add(name.toLowerCase());
  return name;
}
