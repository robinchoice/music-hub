import { REFERRAL_DAYS } from '@music-hub/shared';
import { z } from 'zod';
import { type Command, EXIT, Failure } from '../command';
import { SLUG } from '../config';
import { texts } from '../texts';

const referralSchema = z.object({ code: z.string().nullable(), joined: z.number(), rewarded: z.number() });

// The own referral link and its counts, as under "Account" › "Invite friends" in the web
export const referral: Command = {
  help: [['referral', texts.referralHelp]],
  options: {},
  async run({ api, url, session }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const view = await api.get('/billing/referrals', referralSchema);
    const link = view.code ? `${url}/register?ref=${view.code}` : null;
    const text = link
      ? [link, texts.referralDays(REFERRAL_DAYS.referrer, REFERRAL_DAYS.referred), texts.referralCounts(view.joined, view.rewarded)].join('\n')
      : texts.referralNeedsPlan(`${url}/account#tarif`);
    return { data: { ...view, link }, text };
  },
};
