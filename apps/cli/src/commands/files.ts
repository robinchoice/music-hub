import { existsSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { AUDIO_MIME_BY_EXTENSION, MAX_FILE_SIZE } from '@music-hub/shared';
import { z } from 'zod';
import { type Command, EXIT, Failure, str } from '../command';
import { SLUG } from '../config';
import { findProject, findTrack } from '../lookup';
import { texts } from '../texts';
import { bucket, mb } from './versions';

const listSchema = z.object({
  files: z.array(
    z.looseObject({
      id: z.string(),
      originalFileName: z.string(),
      fileSize: z.number(),
      createdByName: z.string(),
      createdAt: z.string(),
      trackId: z.string().nullable(),
    }),
  ),
});
const uploadSchema = z.object({ uploadUrl: z.string(), fileKey: z.string() });
const createdSchema = z.object({ file: z.looseObject({ id: z.string(), originalFileName: z.string() }) });
const downloadSchema = z.object({ url: z.string() });

// The files of a project that are no version and no stem, as the Files tab of the project page shows them
export const files: Command = {
  help: [
    ['files --project <name or ID> [--track <name or ID>]', texts.filesHelp],
    ['files upload <file> --project <…> [--track <…>]', texts.filesUploadHelp],
    ['files download <name or ID> --project <…> [--out <file>]', texts.filesDownloadHelp],
  ],
  positionals: true,
  options: { project: { type: 'string' }, track: { type: 'string' }, out: { type: 'string' } },
  async run({ api, session, values, positionals }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const [sub, target, ...more] = positionals;
    if (more.length) throw new Failure(texts.filesUsage(SLUG), EXIT.usage);
    // --track narrows the files to those filed next to a song, as its "Dateien" tab shows them
    const at = values.track === undefined ? null : await findTrack(api, values);

    if (sub === 'upload') {
      if (!target) throw new Failure(texts.badOptions(texts.missingFile, SLUG), EXIT.usage);
      const source = Bun.file(target);
      if (!(await source.exists())) throw new Failure(texts.noSuchFile(target), EXIT.error);
      if (source.size > MAX_FILE_SIZE) throw new Failure(texts.fileTooBig(target, mb(MAX_FILE_SIZE)), EXIT.error);
      const fileName = basename(target);
      const mimeType = AUDIO_MIME_BY_EXTENSION[extname(target).toLowerCase() as keyof typeof AUDIO_MIME_BY_EXTENSION] ?? 'application/octet-stream';
      const project = at?.project ?? (await findProject(api, values.project));
      const { uploadUrl, fileKey } = await api.post(`/files/project/${project.id}/upload-url`, uploadSchema, { fileName, mimeType, fileSize: source.size });
      await bucket(uploadUrl, { method: 'PUT', headers: { 'content-type': mimeType }, body: source });
      const { file } = await api.post(`/files/project/${project.id}`, createdSchema, { fileKey, originalFileName: fileName, mimeType, trackId: at?.track.id ?? null });
      return { data: { file }, text: texts.fileUploaded(fileName, at ? at.track.name : project.name) };
    }

    const project = at?.project ?? (await findProject(api, values.project));
    const all = (await api.get(`/files/project/${project.id}`, listSchema)).files;
    const list = at ? all.filter((f) => f.trackId === at.track.id) : all;

    if (sub === 'download') {
      const wanted = target?.trim();
      if (!wanted) throw new Failure(texts.badOptions(texts.missingFile, SLUG), EXIT.usage);
      const file = list.find((f) => f.id === wanted) ?? list.find((f) => f.originalFileName.toLowerCase() === wanted.toLowerCase());
      if (!file) throw new Failure(texts.noSuchProjectFile(wanted, project.name), EXIT.error);
      const out = resolve(str(values.out) ?? basename(file.originalFileName));
      if (existsSync(out)) throw new Failure(texts.fileExists(out), EXIT.error);
      const { url } = await api.get(`/files/${file.id}/download-url`, downloadSchema);
      const bytes = await Bun.write(out, await bucket(url, {}));
      return { data: { file, path: out, bytes }, text: texts.fileDownloaded(file.originalFileName, out, mb(bytes)) };
    }
    if (sub !== undefined) throw new Failure(texts.filesUsage(SLUG), EXIT.usage);

    const line = (f: (typeof list)[number]) => [f.originalFileName, mb(f.fileSize), f.createdByName, f.createdAt.slice(0, 10)].join(' · ');
    return { data: { project, files: list }, text: list.length ? list.map(line).join('\n') : texts.noProjectFiles(at ? at.track.name : project.name) };
  },
};
