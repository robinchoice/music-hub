import { CLI_CLIENT } from '@music-hub/shared';
import { z } from 'zod';
import { type Command, type Context, EXIT, Failure, str } from '../command';
import { removeSession, SLUG, saveSession } from '../config';
import { texts } from '../texts';

export const userSchema = z.object({ id: z.string(), email: z.string(), name: z.string() });
const meSchema = z.object({ user: userSchema.extend({ isAdmin: z.boolean() }).nullable() });
const loginSchema = z.object({ user: userSchema, token: z.string() });
const startSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUrl: z.string(),
  expiresAt: z.string(),
  pollIntervalSeconds: z.number(),
});
const pollSchema = z.union([loginSchema, z.object({ status: z.literal('pending') })]);
const loggedOutSchema = z.object({ message: z.string() });

// The logged-in account, for every command that needs one
export async function currentUser({ api, session }: Context) {
  const user = session && (await api.get('/auth/me', meSchema)).user;
  if (!user) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
  return user;
}

// The device login of the plugin: the user confirms the code in the browser,
// logged in there. Only existing accounts can confirm, so no new ones come about.
async function withDevice({ api, io }: Context) {
  const start = await api.post('/auth/device', startSchema, { client: CLI_CLIENT });
  io.err(texts.confirmCode(start.verificationUrl, start.userCode));
  const expiresAt = new Date(start.expiresAt).getTime();
  while (Date.now() < expiresAt) {
    await io.sleep(start.pollIntervalSeconds * 1000);
    const answer = await api.post('/auth/device/token', pollSchema, { deviceCode: start.deviceCode });
    if ('token' in answer) return answer;
  }
  throw new Failure(texts.codeExpired, EXIT.error);
}

// A login link from the mail or from the Kontor's login-link (README, „CLI“)
async function withLink({ api, io }: Context, link: string) {
  const text = link === '-' ? await io.stdin() : link;
  const token = URL.parse(text.trim())?.searchParams.get('token');
  if (!token) throw new Failure(texts.linkIncomplete, EXIT.usage);
  return api.post('/auth/verify', loginSchema, { token, cookie: false });
}

export const auth: Record<string, Command> = {
  login: {
    help: [
      ['login', texts.loginHelp],
      ['login --link <link>|-', texts.linkHelp],
    ],
    options: { link: { type: 'string' } },
    async run(ctx) {
      // A new login replaces the token of this device: the old one is revoked first, so none stays valid unseen
      if (ctx.session) {
        await ctx.api.post('/auth/logout', loggedOutSchema);
        await removeSession(ctx.io.env);
      }
      const link = str(ctx.values.link);
      const { user, token } = link === undefined ? await withDevice(ctx) : await withLink(ctx, link);
      await saveSession(ctx.io.env, { url: ctx.url, token });
      return { data: { user }, text: texts.loggedIn(user.email) };
    },
  },

  whoami: {
    help: [['whoami', texts.whoamiHelp]],
    async run(ctx) {
      const user = await currentUser(ctx);
      return { data: { user }, text: `${user.name} <${user.email}>${user.isAdmin ? ' · Admin' : ''}` };
    },
  },

  logout: {
    help: [['logout', texts.logoutHelp]],
    async run({ api, session, io }) {
      if (session) {
        await api.post('/auth/logout', loggedOutSchema);
        await removeSession(io.env);
      }
      return { data: { ok: true }, text: texts.loggedOut };
    },
  },
};
