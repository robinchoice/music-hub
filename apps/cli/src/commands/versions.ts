import { existsSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import {
  AUDIO_MIME_BY_EXTENSION,
  type Comparison,
  compareMeasurements,
  MAX_FILE_SIZE,
  measurementsSchema,
  predecessorOf,
  SUPPORTED_EXTENSIONS,
  THIRD_OCTAVE_HZ,
  VERSION_STATUSES,
} from '@music-hub/shared';
import { z } from 'zod';
import { type Command, EXIT, Failure, str } from '../command';
import { SLUG } from '../config';
import { findProject, findTrack, findVersion, type Version, versionsOf } from '../lookup';
import { texts } from '../texts';

const uploadSchema = z.object({ uploadUrl: z.string(), fileKey: z.string() });
const createdSchema = z.object({ version: z.looseObject({ id: z.string(), versionNumber: z.number(), status: z.enum(VERSION_STATUSES) }) });
const downloadSchema = z.object({ url: z.string() });
const movedSchema = z.object({ version: z.looseObject({ id: z.string(), versionNumber: z.number(), trackId: z.string() }) });
const splitSchema = z.object({ track: z.looseObject({ id: z.string(), name: z.string() }), version: z.looseObject({ id: z.string(), versionNumber: z.number() }) });
// What the measurement needs of a version; an older API has no measurements
const measuredSchema = z.object({
  id: z.string(),
  versionNumber: z.number(),
  parentVersionId: z.string().nullable(),
  branchLabel: z.string().nullable(),
  integratedLufs: z.number().nullable(),
  truePeak: z.number().nullable(),
  measurements: measurementsSchema.nullable().optional().transform((m) => m ?? null),
});

// The project's reference track; an older API has none
const referenceSchema = z.object({
  reference: z
    .object({ id: z.string(), originalFileName: z.string(), measurements: measurementsSchema.nullable(), integratedLufs: z.number().nullable() })
    .nullable()
    .optional()
    .transform((r) => r ?? null),
});

const signed = (x: number, digits: number) => {
  // + 0 turns a rounded −0 into 0
  const r = Number(x.toFixed(digits)) + 0;
  return `${r > 0 ? '+' : ''}${r.toFixed(digits)}`;
};
const hz = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

export const mb = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

function line(v: Version) {
  const label = v.label || (v.autoMix ? texts.automaticMix : '');
  return [
    `V${v.versionNumber}${label ? ` ${label}` : ''}`,
    texts.versionStatus[v.status],
    texts.openComments(v.openCommentCount),
    v.createdAt.slice(0, 10),
  ].join(' · ');
}

// The bucket answers presigned URLs directly; they carry their own signature, never the token of the CLI
export async function bucket(url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Failure(texts.storageUnreachable, EXIT.error);
  }
  if (!res.ok) throw new Failure(texts.storageFailed(res.status), EXIT.error);
  return res;
}

// The versions of a track, a new one from a file as the upload in the web makes it, and the original back
export const versions: Command = {
  help: [
    ['versions --project <name or ID> --track <name or ID>', texts.versionsHelp],
    ['versions upload <file> --project <…> --track <…> [--label <text>]', texts.versionsUploadHelp(SUPPORTED_EXTENSIONS.join(', '))],
    ['versions download --project <…> --track <…> [--version <n>] [--out <file>]', texts.versionsDownloadHelp],
    ['versions measure --project <…> --track <…> [--version <n>]', texts.versionsMeasureHelp],
    ['versions move --project <…> --track <…> --version <n> --to <track> [--to-project <…>]', texts.versionsMoveHelp],
    ['versions split --project <…> --track <…> --version <n> [--name <text>]', texts.versionsSplitHelp],
  ],
  positionals: true,
  options: {
    project: { type: 'string' },
    track: { type: 'string' },
    version: { type: 'string' },
    label: { type: 'string' },
    out: { type: 'string' },
    to: { type: 'string' },
    'to-project': { type: 'string' },
    name: { type: 'string' },
  },
  async run({ api, session, values, positionals }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const [sub, file, ...more] = positionals;
    if (more.length) throw new Failure(texts.versionsUsage(SLUG), EXIT.usage);

    if (sub === 'upload') {
      if (!file) throw new Failure(texts.badOptions(texts.missingFile, SLUG), EXIT.usage);
      const extension = extname(file).toLowerCase();
      const mimeType = AUDIO_MIME_BY_EXTENSION[extension as keyof typeof AUDIO_MIME_BY_EXTENSION];
      if (!mimeType) throw new Failure(texts.unsupportedFile(file, SUPPORTED_EXTENSIONS.join(', ')), EXIT.error);
      const source = Bun.file(file);
      if (!(await source.exists())) throw new Failure(texts.noSuchFile(file), EXIT.error);
      if (source.size > MAX_FILE_SIZE) throw new Failure(texts.fileTooBig(file, mb(MAX_FILE_SIZE)), EXIT.error);
      const fileName = basename(file);
      const label = str(values.label)?.trim();

      const { track } = await findTrack(api, values);
      const { uploadUrl, fileKey } = await api.post(`/versions/track/${track.id}/upload-url`, uploadSchema, { fileName, mimeType, fileSize: source.size });
      await bucket(uploadUrl, { method: 'PUT', headers: { 'content-type': mimeType }, body: source });
      const { version } = await api.post(`/versions/track/${track.id}`, createdSchema, {
        fileKey,
        originalFileName: fileName,
        mimeType,
        fileSize: source.size,
        ...(label && { label }),
      });
      return { data: { version }, text: texts.uploaded(fileName, version.versionNumber, track.name) };
    }

    if (sub === 'download' && !file) {
      const { track, version } = await findVersion(api, values);
      const out = resolve(str(values.out) ?? basename(version.originalFileName));
      // Never over an existing file, it may be the only copy of something else
      if (existsSync(out)) throw new Failure(texts.fileExists(out), EXIT.error);
      const { url } = await api.get(`/versions/${version.id}/download-url`, downloadSchema);
      const bytes = await Bun.write(out, await bucket(url, {}));
      return { data: { version, file: out, bytes }, text: texts.downloaded(version.versionNumber, track.name, out, mb(bytes)) };
    }
    if (sub === 'measure' && !file) {
      const found = await findVersion(api, values);
      const list = found.versions.map((v) => measuredSchema.parse(v));
      const version = list.find((v) => v.id === found.version.id)!;
      const previous = predecessorOf(version, list);
      const { reference } = await api.get(`/versions/track/${found.track.id}`, referenceSchema);
      const { measurements } = version;
      const head = { project: found.project, track: found.track, version: { id: version.id, versionNumber: version.versionNumber } };
      if (!measurements) return { data: { ...head, measurements: null }, text: texts.notMeasured(version.versionNumber, found.track.name) };
      const comparison = previous?.measurements ? compareMeasurements({ ...version, measurements }, { ...previous, measurements: previous.measurements }) : null;
      const against = comparison && previous ? previous.versionNumber : null;
      // ffmpeg measures no true peak for a reference, so there is no crest to compare
      const versusReference = reference?.measurements
        ? compareMeasurements({ ...version, measurements }, { measurements: reference.measurements, integratedLufs: reference.integratedLufs, truePeak: null })
        : null;
      const column = (c: Comparison | null, i: number) => (c ? signed(c.bandDiffDb[i]!, 1).padStart(12) : '');
      const text = [
        texts.measuredHead(version.versionNumber, found.track.name),
        texts.stereoImage(measurements.width.toFixed(2), measurements.correlation.toFixed(2), measurements.monoLossLu.toFixed(1)),
        texts.bandsHead(version.versionNumber, against, versusReference !== null),
        ...THIRD_OCTAVE_HZ.map((f, i) =>
          [hz(f).padEnd(6), measurements.bands[i]!.toFixed(1).padStart(7), comparison ? column(comparison, i) : versusReference ? ''.padStart(12) : '', column(versusReference, i)]
            .join('')
            .trimEnd(),
        ),
        ...(comparison && against !== null
          ? [
              texts.comparedWith(
                against,
                comparison.lufsDiff === null ? null : signed(comparison.lufsDiff, 1),
                comparison.crestDiffDb === null ? null : signed(comparison.crestDiffDb, 1),
                signed(comparison.widthDiff, 2),
              ),
            ]
          : []),
        ...(reference && versusReference
          ? [texts.comparedWithReference(reference.originalFileName, versusReference.lufsDiff === null ? null : signed(versusReference.lufsDiff, 1), signed(versusReference.widthDiff, 2))]
          : reference
            ? [texts.referencePending(reference.originalFileName)]
            : []),
      ].join('\n');
      return {
        data: {
          ...head,
          measurements,
          previous: previous && against !== null ? { id: previous.id, versionNumber: previous.versionNumber } : null,
          comparison,
          reference: reference ? { id: reference.id, originalFileName: reference.originalFileName, measured: reference.measurements !== null } : null,
          referenceComparison: versusReference,
        },
        text,
      };
    }
    if (sub === 'move' && !file) {
      if (!str(values.version) || !str(values.to)) throw new Failure(texts.badOptions(texts.missingOption(str(values.version) ? '--to' : '--version'), SLUG), EXIT.usage);
      const { project, track, version } = await findVersion(api, values);
      const toProject = values['to-project'] ? await findProject(api, values['to-project']) : project;
      const target = await findTrack(api, { project: toProject.id, track: values.to });
      const { version: moved } = await api.post(`/versions/${version.id}/move`, movedSchema, { trackId: target.track.id });
      return { data: { version: moved }, text: texts.versionMoved(version.versionNumber, track.name, moved.versionNumber, target.track.name) };
    }
    if (sub === 'split' && !file) {
      if (!str(values.version)) throw new Failure(texts.badOptions(texts.missingOption('--version'), SLUG), EXIT.usage);
      const { track, version } = await findVersion(api, values);
      const name = str(values.name)?.trim();
      const split = await api.post(`/versions/${version.id}/split`, splitSchema, name ? { name } : {});
      return { data: split, text: texts.versionSplit(version.versionNumber, track.name, split.track.name) };
    }
    if (sub !== undefined) throw new Failure(texts.versionsUsage(SLUG), EXIT.usage);

    const { project, track } = await findTrack(api, values);
    const list = await versionsOf(api, track);
    return { data: { project, track, versions: list }, text: list.length ? list.map(line).join('\n') : texts.noVersions(track.name) };
  },
};
