import { z } from 'zod';
import { type Command, EXIT, Failure, str } from '../command';
import { SLUG } from '../config';
import { findVersion } from '../lookup';
import { texts } from '../texts';

const person = z.object({ id: z.string(), name: z.string() }).nullable();
const commentSchema = z.looseObject({
  id: z.string(),
  body: z.string(),
  timestampSeconds: z.number().nullable(),
  parentId: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  guestName: z.string().nullable(),
  user: person,
  deletedAt: z.string().nullable(),
});
type Comment = z.infer<typeof commentSchema>;
const listSchema = z.object({ comments: z.array(commentSchema) });
const createdSchema = z.object({ comment: z.looseObject({ id: z.string(), body: z.string() }) });

// 83 → 1:23, as the player shows it
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// --at as 1:23 or 83 (seconds, also 83.5)
function at(value: unknown) {
  if (value === undefined) return undefined;
  const match = typeof value === 'string' ? /^(?:(\d+):([0-5]\d)|(\d+(?:\.\d+)?))$/.exec(value.trim()) : null;
  if (!match) throw new Failure(texts.badOptions(texts.badTime, SLUG), EXIT.usage);
  return match[3] !== undefined ? Number(match[3]) : Number(match[1]) * 60 + Number(match[2]);
}

function text(c: Comment) {
  if (c.deletedAt) return texts.deletedComment;
  const who = c.user?.name ?? c.guestName ?? '?';
  return `${c.timestampSeconds === null ? '' : `${clock(c.timestampSeconds)} · `}${who}: ${c.body}${c.resolvedAt ? ` (${texts.resolved})` : ''}`;
}

// The comments on a version as the track page shows them, replies under their comment, and a new one
export const comments: Command = {
  help: [
    ['comments --project <…> --track <…> [--version <n>]', texts.commentsHelp],
    ['comments add <text> --project <…> --track <…> [--version <n>] [--at <1:23>]', texts.commentsAddHelp],
  ],
  positionals: true,
  options: { project: { type: 'string' }, track: { type: 'string' }, version: { type: 'string' }, at: { type: 'string' } },
  async run({ api, session, values, positionals }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const [sub, ...words] = positionals;

    if (sub === 'add') {
      const body = words.join(' ').trim();
      if (!body) throw new Failure(texts.badOptions(texts.missingText, SLUG), EXIT.usage);
      const timestampSeconds = at(values.at);
      const { track, version } = await findVersion(api, values);
      const { comment } = await api.post(`/comments/version/${version.id}`, createdSchema, {
        body,
        ...(timestampSeconds !== undefined && { timestampSeconds }),
      });
      const where = timestampSeconds === undefined ? '' : ` ${texts.atTime(clock(timestampSeconds))}`;
      return { data: { comment }, text: texts.commented(version.versionNumber, track.name, where) };
    }
    if (sub !== undefined || str(values.at) !== undefined) throw new Failure(texts.commentsUsage(SLUG), EXIT.usage);

    const { track, version } = await findVersion(api, values);
    const list = (await api.get(`/comments/version/${version.id}?commentsOnly=true`, listSchema)).comments;
    const lines = list
      .filter((c) => !c.parentId)
      .flatMap((c) => [text(c), ...list.filter((r) => r.parentId === c.id).map((r) => `  ↳ ${text(r)}`)]);
    return {
      data: { version: { id: version.id, versionNumber: version.versionNumber }, comments: list },
      text: lines.length ? [`${track.name} V${version.versionNumber}`, ...lines].join('\n') : texts.noComments(version.versionNumber),
    };
  },
};
