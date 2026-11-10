import { MEMBER_RIGHTS, type MemberRight, PROJECT_ROLES, ROLE_LABELS } from '@music-hub/shared';
import { z } from 'zod';
import { type Command, EXIT, Failure, str } from '../command';
import { SLUG } from '../config';
import { findProject } from '../lookup';
import { texts } from '../texts';

const membersSchema = z.object({
  members: z.array(
    z.object({
      id: z.string(),
      roles: z.array(z.enum(PROJECT_ROLES)),
      canUpload: z.boolean(),
      canDownload: z.boolean(),
      canComment: z.boolean(),
      canApprove: z.boolean(),
      canInvite: z.boolean(),
      user: z.object({ email: z.string(), name: z.string() }),
    }),
  ),
});

// The rights by the words the command takes
const WORDS: Record<string, MemberRight> = { upload: 'canUpload', download: 'canDownload', comment: 'canComment', approve: 'canApprove', invite: 'canInvite' };
const wordOf = (right: MemberRight) => Object.keys(WORDS).find((w) => WORDS[w] === right)!;

function rightsFrom(value: unknown, to: boolean) {
  const words = (str(value) ?? '').split(',').map((w) => w.trim()).filter(Boolean);
  const unknown = words.find((w) => !WORDS[w]);
  if (unknown) throw new Failure(texts.badRight(unknown, Object.keys(WORDS).join(', ')), EXIT.usage);
  return Object.fromEntries(words.map((w) => [WORDS[w], to]));
}

// Who is in a project with which roles and rights, and single rights per person, like the settings of the web
export const members: Command = {
  help: [
    ['members --project <name or ID>', texts.membersHelp],
    ['members set <email> --project <name or ID> [--allow <rights>] [--deny <rights>]', texts.membersSetHelp],
  ],
  positionals: true,
  options: { project: { type: 'string' }, allow: { type: 'string' }, deny: { type: 'string' } },
  async run({ api, session, values, positionals }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const [sub, email, ...rest] = positionals;
    if ((sub !== undefined && sub !== 'set') || rest.length) throw new Failure(texts.membersUsage(SLUG), EXIT.usage);

    const project = await findProject(api, values.project);
    const list = async () => (await api.get(`/projects/${project.id}/members`, membersSchema)).members;

    if (sub === 'set') {
      const rights = { ...rightsFrom(values.allow, true), ...rightsFrom(values.deny, false) };
      if (!email || !Object.keys(rights).length) throw new Failure(texts.membersUsage(SLUG), EXIT.usage);
      const member = (await list()).find((m) => m.user.email.toLowerCase() === email.toLowerCase());
      if (!member) throw new Failure(texts.noSuchMember(email, project.name), EXIT.error);
      await api.patch(`/projects/${project.id}/members/${member.id}`, z.unknown(), { rights });
      const updated = (await list()).find((m) => m.id === member.id)!;
      return { data: { project, member: updated }, text: texts.rightsSet(updated.user.name, project.name) };
    }

    const all = await list();
    const line = (m: (typeof all)[number]) =>
      [`${m.user.name} <${m.user.email}>`, m.roles.map((r) => ROLE_LABELS.en[r]).join(', '), MEMBER_RIGHTS.filter((r) => m[r]).map(wordOf).join(', ') || texts.listenOnly].join(' · ');
    return { data: { project, members: all }, text: all.map(line).join('\n') };
  },
};
