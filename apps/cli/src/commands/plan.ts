import { PLAN_PERIODS, PLANS } from '@music-hub/shared';
import { z } from 'zod';
import { type Command, EXIT, Failure } from '../command';
import { SLUG } from '../config';
import { texts } from '../texts';

const billingSchema = z.object({
  plan: z.enum(PLANS).nullable(),
  planUntil: z.string().nullable(),
  renews: z.boolean(),
  storage: z.object({ usedBytes: z.number(), limitBytes: z.number() }),
  payments: z.array(
    z.object({
      method: z.enum(['stripe', 'lightning']),
      plan: z.enum(PLANS),
      period: z.enum(PLAN_PERIODS),
      amountCents: z.number(),
      status: z.enum(['pending', 'paid', 'expired']),
      createdAt: z.string(),
    }),
  ),
});

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const PLAN_NAMES = { pro: 'Pro', solo: 'Studio' } as const;

// The running plan, storage and payments, as under "Account" › "Plan" in the web. Buying happens there.
export const plan: Command = {
  help: [['plan', texts.planHelp]],
  options: {},
  async run({ api, url, session }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const view = await api.get('/billing', billingSchema);
    const name = view.plan ? PLAN_NAMES[view.plan] : 'Free';
    const lines = [
      `${view.plan && view.planUntil ? texts.planUntil(name, view.planUntil.slice(0, 10)) : name}${view.renews ? ` · ${texts.planRenews}` : ''}`,
      texts.storageUsed(gb(view.storage.usedBytes), gb(view.storage.limitBytes)),
      ...view.payments.map((p) => `${p.createdAt.slice(0, 10)} · ${PLAN_NAMES[p.plan]} · ${(p.amountCents / 100).toFixed(2)} EUR · ${p.method} · ${p.status}`),
      texts.planBuy(`${url}/account#tarif`),
    ];
    return { data: view, text: lines.join('\n') };
  },
};
