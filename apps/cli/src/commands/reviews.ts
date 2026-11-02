import { REVIEW_VERDICTS } from '@music-hub/shared';
import { z } from 'zod';
import { type Command, EXIT, Failure, str } from '../command';
import { SLUG } from '../config';
import { findVersion } from '../lookup';
import { texts } from '../texts';

const reviewSchema = z.looseObject({
  id: z.string(),
  verdict: z.enum(REVIEW_VERDICTS).nullable(),
  note: z.string().nullable(),
  commentCount: z.number(),
  guestName: z.string().nullable(),
  user: z.object({ id: z.string(), name: z.string() }).nullable(),
});
type Review = z.infer<typeof reviewSchema>;
const listSchema = z.object({
  reviews: z.array(reviewSchema),
  waiting: z.array(z.object({ id: z.string(), name: z.string() })),
  uploader: z.object({ id: z.string(), name: z.string() }).nullable(),
});
const createdSchema = z.object({ review: reviewSchema.omit({ user: true, guestName: true }) });

const verdicts = REVIEW_VERDICTS.join(', ');

function line(r: Review) {
  return [
    r.user?.name ?? r.guestName ?? '?',
    r.verdict ? texts.verdict[r.verdict] : texts.noVerdict,
    texts.commentCount(r.commentCount),
    ...(r.note ? [r.note] : []),
  ].join(' · ');
}

// "Fertig mit V4" of the track page: who finished listening with which verdict, who is still missing, and the own pass
export const reviews: Command = {
  help: [
    ['reviews --project <…> --track <…> [--version <n>]', texts.reviewsHelp],
    ['reviews send <verdict> --project <…> --track <…> [--version <n>] [--note <text>]', texts.reviewsSendHelp(verdicts)],
  ],
  positionals: true,
  options: { project: { type: 'string' }, track: { type: 'string' }, version: { type: 'string' }, note: { type: 'string' } },
  async run({ api, session, values, positionals }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const [sub, verdict, ...more] = positionals;
    if (more.length) throw new Failure(texts.reviewsUsage(SLUG), EXIT.usage);

    if (sub === 'send') {
      if (!verdict) throw new Failure(texts.reviewsUsage(SLUG), EXIT.usage);
      if (!(REVIEW_VERDICTS as readonly string[]).includes(verdict)) throw new Failure(texts.badOptions(texts.badVerdict(verdict, verdicts), SLUG), EXIT.usage);
      const note = str(values.note)?.trim();
      const { track, version } = await findVersion(api, values);
      const { review } = await api.post(`/versions/${version.id}/reviews`, createdSchema, { verdict, ...(note && { note }) });
      return { data: { review }, text: texts.reviewSent(version.versionNumber, track.name, review.verdict ? texts.verdict[review.verdict] : texts.noVerdict) };
    }
    if (sub !== undefined || str(values.note) !== undefined) throw new Failure(texts.reviewsUsage(SLUG), EXIT.usage);

    const { track, version } = await findVersion(api, values);
    const list = await api.get(`/comments/version/${version.id}`, listSchema);
    const lines = [
      `${track.name} V${version.versionNumber}`,
      ...(list.reviews.length ? list.reviews.map(line) : [texts.noReviews]),
      ...(list.waiting.length ? [texts.waitingFor(list.waiting.map((p) => p.name).join(', '))] : []),
    ];
    return { data: { version: { id: version.id, versionNumber: version.versionNumber }, ...list }, text: lines.join('\n') };
  },
};
