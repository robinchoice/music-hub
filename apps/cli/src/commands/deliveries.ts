import {
  DEFAULT_INCLUDED_ROUNDS,
  DELIVERY_STATUSES,
  DELIVERY_TRACK_STATES,
  formatEuro,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PROJECT_ROLES,
} from '@music-hub/shared';
import { z } from 'zod';
import type { Client } from '../client';
import { type Command, EXIT, Failure, str } from '../command';
import { SLUG } from '../config';
import { texts } from '../texts';

const projectsSchema = z.object({
  projects: z.array(z.object({ project: z.object({ id: z.string(), name: z.string() }), roles: z.array(z.enum(PROJECT_ROLES)) })),
});
const tracksSchema = z.object({ tracks: z.array(z.object({ id: z.string(), name: z.string() })) });

// The fields of StudioDelivery the text needs; --json passes on the whole answer
const deliverySchema = z.looseObject({
  id: z.string(),
  projectId: z.string(),
  linkToken: z.string(),
  status: z.enum(DELIVERY_STATUSES),
  clientName: z.string(),
  clientEmail: z.string().nullable(),
  reference: z.string().nullable(),
  includedRounds: z.number(),
  extraRoundCents: z.number(),
  includeStems: z.boolean(),
  tracks: z.array(
    z.looseObject({
      name: z.string(),
      priceCents: z.number(),
      roundsUsed: z.number(),
      roundsIncluded: z.number(),
      extraRounds: z.number(),
      state: z.enum(DELIVERY_TRACK_STATES),
      shownVersionNumber: z.number().nullable(),
    }),
  ),
  payments: z.array(
    z.looseObject({
      id: z.string(),
      method: z.enum(PAYMENT_METHODS),
      status: z.enum(PAYMENT_STATUSES),
      amountCents: z.number(),
      createdAt: z.string(),
    }),
  ),
  totals: z.looseObject({
    extraRounds: z.number(),
    extraCents: z.number(),
    totalCents: z.number(),
    approvedCount: z.number(),
    trackCount: z.number(),
  }),
});
type Delivery = z.infer<typeof deliverySchema>;
const oneSchema = z.object({ delivery: deliverySchema });
const listSchema = z.object({ deliveries: z.array(deliverySchema), canCreate: z.boolean() });

type Project = { id: string; name: string; owner: boolean };

async function ownProjects(api: Client): Promise<Project[]> {
  return (await api.get('/projects', projectsSchema)).projects.map(({ project, roles }) => ({ ...project, owner: roles.includes('owner') }));
}

// By ID or by name, as `share --project`
function findProject(list: Project[], wanted: string) {
  const project = list.find((p) => p.id === wanted) ?? list.find((p) => p.name.toLowerCase() === wanted.toLowerCase());
  if (!project) throw new Failure(texts.noSuchProject(wanted, SLUG), EXIT.error);
  if (!project.owner) throw new Failure(texts.notOwner(project.name), EXIT.error);
  return project;
}

const usage = (detail: string) => new Failure(texts.badOptions(detail, SLUG), EXIT.usage);

// "40", "12,50" or "12.5" to cents, without floating point
function cents(value: unknown, option: string) {
  const match = typeof value === 'string' ? /^(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(value.trim()) : null;
  if (!match) throw usage(texts.badEuro(option));
  return Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'));
}

function rounds(value: unknown) {
  if (value === undefined) return undefined;
  const n = typeof value === 'string' && /^\d{1,2}$/.test(value) ? Number(value) : -1;
  if (n < 0 || n > 20) throw usage(texts.badRounds);
  return n;
}

const linkOf = (url: string, d: Delivery) => `${url}/album/${d.linkToken}`;

function line(d: Delivery, projectName: string) {
  return [d.id, projectName, d.clientName, texts.deliveryStatus[d.status], texts.approved(d.totals.approvedCount, d.totals.trackCount), formatEuro(d.totals.totalCents)].join(' · ');
}

function details(d: Delivery, url: string) {
  const extra = d.totals.extraRounds ? texts.extraRoundsAt(d.totals.extraRounds, formatEuro(d.totals.extraCents)) : '';
  return [
    `${texts.deliveryFor(d.clientName)} · ${texts.deliveryStatus[d.status]}`,
    `${texts.link}: ${linkOf(url, d)}`,
    ...(d.reference ? [`${texts.reference}: ${d.reference}`] : []),
    ...(d.clientEmail ? [`${texts.email}: ${d.clientEmail}`] : []),
    texts.roundsLine(d.includedRounds, formatEuro(d.extraRoundCents)),
    texts.stemsLine(d.includeStems),
    `${texts.songs}:`,
    ...d.tracks.map((t) =>
      [
        `  ${t.name}${t.shownVersionNumber === null ? '' : ` (V${t.shownVersionNumber})`}`,
        formatEuro(t.priceCents),
        texts.trackState[t.state],
        texts.roundsOf(t.roundsUsed, t.roundsIncluded),
      ].join(' · '),
    ),
    ...(d.payments.length
      ? [
          `${texts.payments}:`,
          ...d.payments.map((p) =>
            [`  ${texts.paymentMethod[p.method]}`, texts.paymentStatus[p.status], formatEuro(p.amountCents), new Date(p.createdAt).toLocaleDateString('de-DE')].join(' · '),
          ),
        ]
      : []),
    texts.total(formatEuro(d.totals.totalCents), extra),
  ].join('\n');
}

const one = (d: Delivery, url: string) => ({ data: { delivery: d, url: linkOf(url, d) }, text: details(d, url) });

// Orders (Aufträge) on the own project link, as the studio view of the web manages them
export const deliveries: Command = {
  help: [
    ['deliveries list [--project <Name oder ID>]', texts.deliveriesListHelp],
    ['deliveries show <ID>', texts.deliveriesShowHelp],
    ['deliveries create', texts.deliveriesCreateHelp],
    ['  --project <Name oder ID>', texts.deliveryProjectHelp],
    ['  --client <Name>', texts.deliveryClientHelp],
    ['  --price <Euro>', texts.deliveryPriceHelp],
    ['  --track <Name>', texts.deliveryTrackHelp],
    ['  --email <Adresse>', texts.deliveryEmailHelp],
    ['  --reference <Text>', texts.deliveryReferenceHelp],
    ['  --rounds <Anzahl>', texts.deliveryRoundsHelp(DEFAULT_INCLUDED_ROUNDS)],
    ['  --extra <Euro>', texts.deliveryExtraHelp],
    ['  --no-stems', texts.deliveryNoStemsHelp],
    ['deliveries confirm-payment <ID>', texts.deliveriesConfirmHelp],
    ['deliveries cancel <ID>', texts.deliveriesCancelHelp],
  ],
  positionals: true,
  options: {
    project: { type: 'string' },
    client: { type: 'string' },
    price: { type: 'string' },
    track: { type: 'string', multiple: true },
    email: { type: 'string' },
    reference: { type: 'string' },
    rounds: { type: 'string' },
    extra: { type: 'string' },
    'no-stems': { type: 'boolean' },
  },
  async run({ api, url, session, values, positionals }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const [sub, id, ...more] = positionals;
    if (more.length) throw new Failure(texts.deliveryUsage(SLUG), EXIT.usage);
    const needId = () => {
      if (!id) throw usage(texts.missingId);
      return encodeURIComponent(id);
    };

    if (sub === 'list' && !id) {
      const all = await ownProjects(api);
      const wanted = str(values.project)?.trim();
      const chosen = wanted ? [findProject(all, wanted)] : all.filter((p) => p.owner);
      const lists = await Promise.all(chosen.map((p) => api.get(`/deliveries/project/${p.id}`, listSchema)));
      const names = new Map(chosen.map((p) => [p.id, p.name]));
      const list = lists.flatMap((l) => l.deliveries);
      return {
        data: { deliveries: list },
        text: list.length ? list.map((d) => line(d, names.get(d.projectId) ?? '')).join('\n') : texts.noDeliveries,
      };
    }

    if (sub === 'show') return one((await api.get(`/deliveries/${needId()}`, oneSchema)).delivery, url);

    if (sub === 'cancel') return one((await api.post(`/deliveries/${needId()}/cancel`, oneSchema)).delivery, url);

    if (sub === 'confirm-payment') {
      const path = `/deliveries/${needId()}`;
      const { delivery } = await api.get(path, oneSchema);
      const open = delivery.payments.find((p) => p.method === 'transfer' && (p.status === 'pending' || p.status === 'announced'));
      if (!open) throw new Failure(texts.noOpenTransfer, EXIT.error);
      const confirmed = (await api.post(`${path}/payments/${open.id}/confirm`, oneSchema)).delivery;
      return { ...one(confirmed, url), text: texts.paymentConfirmed(formatEuro(open.amountCents)) };
    }

    if (sub === 'create' && !id) {
      const wanted = str(values.project)?.trim();
      const clientName = str(values.client)?.trim();
      if (!wanted) throw usage(texts.missingOption('--project'));
      if (!clientName) throw usage(texts.missingOption('--client'));
      if (values.price === undefined) throw usage(texts.missingOption('--price'));
      const priceCents = cents(values.price, '--price');
      const includedRounds = rounds(values.rounds);
      const extraRoundCents = values.extra === undefined ? undefined : cents(values.extra, '--extra');
      const email = str(values.email)?.trim();
      const reference = str(values.reference)?.trim();

      const project = findProject(await ownProjects(api), wanted);
      const tracks = (await api.get(`/tracks/project/${project.id}`, tracksSchema)).tracks;
      const names = Array.isArray(values.track) ? values.track.filter((name) => typeof name === 'string') : [];
      const picked = names.length
        ? names.map((name) => {
            const track = tracks.find((t) => t.id === name) ?? tracks.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
            if (!track) throw new Failure(texts.noSuchTrack(name), EXIT.error);
            return track;
          })
        : tracks;
      if (!picked.length) throw new Failure(texts.noTracks, EXIT.error);

      const { delivery } = await api.post(`/deliveries/project/${project.id}`, oneSchema, {
        clientName,
        ...(email && { clientEmail: email }),
        ...(reference && { reference }),
        ...(includedRounds !== undefined && { includedRounds }),
        ...(extraRoundCents !== undefined && { extraRoundCents }),
        includeStems: values['no-stems'] !== true,
        tracks: [...new Set(picked)].map((t) => ({ trackId: t.id, priceCents })),
      });
      return one(delivery, url);
    }

    throw new Failure(texts.deliveryUsage(SLUG), EXIT.usage);
  },
};
