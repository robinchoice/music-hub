import { z } from 'zod';
import { DELIVERY_ERROR_CODES, DELIVERY_ERRORS, formatEuro, type DeliveryErrorCode, type DeliveryTrackState } from '@music-hub/shared';

// What the client and the studio read for the state of a song
export const CLIENT_STATE_LABELS: Record<DeliveryTrackState, string> = {
  review: 'Zum Anhören',
  changes: 'Studio arbeitet',
  approved: 'Freigegeben',
};
export const STUDIO_STATE_LABELS: Record<DeliveryTrackState, string> = {
  review: 'Beim Kunden',
  changes: 'Änderungen gewünscht',
  approved: 'Freigegeben',
};

/** "120", "120,50" or "1.234,5" in euros as cents; null when it is no amount */
export function parseEuro(text: string): number | null {
  const clean = text.replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Cents for an input field: "120" or "120,50" */
export const euroInput = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ','));

/** An IBAN in groups of four */
export const formatIban = (iban: string) => iban.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();

type Rounds = { roundsUsed: number; roundsIncluded: number; giftedRounds: number; extraRounds: number; extraCents: number };

/**
 * One dot per round: the free ones first (included, then the ones the studio gave on top), used or
 * still open, then one per extra round the client ordered
 */
export function roundDots(t: Rounds) {
  const freeUsed = t.roundsUsed - t.extraRounds;
  const free = Array.from({ length: Math.max(t.roundsIncluded, freeUsed) }, (_, i) => ({
    used: i < freeUsed,
    gifted: i >= t.roundsIncluded - t.giftedRounds && i < t.roundsIncluded,
    extra: false,
  }));
  return [...free, ...Array.from({ length: t.extraRounds }, () => ({ used: true, gifted: false, extra: true }))];
}

/** "1 von 2 Korrekturrunden genutzt", plus the extra rounds with what they cost */
export function roundsText(t: Rounds) {
  const freeUsed = t.roundsUsed - t.extraRounds;
  const gifted = t.giftedRounds ? ` (${t.giftedRounds} geschenkt)` : '';
  const extra = t.extraRounds ? `${plural(t.extraRounds, 'Zusatzrunde', 'Zusatzrunden')} (${formatEuro(t.extraCents)})` : '';
  if (t.roundsIncluded > 0) return `${freeUsed} von ${t.roundsIncluded} Korrekturrunden genutzt${gifted}${extra ? ` + ${extra}` : ''}`;
  if (freeUsed > 0) return `${plural(freeUsed, 'Runde', 'Runden')} genutzt, keine inklusive${extra ? ` + ${extra}` : ''}`;
  return `Keine Korrekturrunde inklusive${extra ? ` · ${extra}` : ''}`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const errorAnswer = z.object({
  error: z.string(),
  code: z.enum(DELIVERY_ERROR_CODES).exactOptional(),
  extraRoundCents: z.number().exactOptional(),
});

/** A failed guest request with the reason the API gave */
export class GuestError extends Error {
  status: number;
  code: DeliveryErrorCode | undefined;
  extraRoundCents: number | undefined;
  constructor(message: string, status: number, code?: DeliveryErrorCode, extraRoundCents?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.extraRoundCents = extraRoundCents;
  }
}

/** A request of the client to their project link's delivery, with the link's password */
export async function guestRequest<T>(token: string, path: string, password: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/share/project/public/${token}/delivery${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(password ? { 'X-Share-Password': password } : {}),
      },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new GuestError('Keine Verbindung. Bitte prüfe dein Internet und versuche es erneut.', 0);
  }
  if (!res.ok) {
    const answer = errorAnswer.safeParse(await res.json().catch(() => null)).data;
    const message = answer?.code
      ? answer.error
      : res.status === 429
        ? 'Zu viele Versuche. Bitte warte etwas und versuche es erneut.'
        : res.status === 410
          ? DELIVERY_ERRORS.unavailable
          : 'Das hat nicht geklappt. Bitte versuche es erneut.';
    throw new GuestError(message, res.status, answer?.code, answer?.extraRoundCents);
  }
  return res.json();
}
