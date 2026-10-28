import { locale, t } from '$lib/i18n/index.js';
import { z } from 'zod';
import { DELIVERY_ERROR_CODES, DELIVERY_ERRORS, formatEuro, type DeliveryErrorCode } from '@music-hub/shared';

/** "120", "120,50" or "1.234,5" in euros as cents; null when it is no amount */
export function parseEuro(text: string): number | null {
  const clean = text.replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Cents for an input field: "120" or "120,50" ("120.50" in English) */
export const euroInput = (cents: number) => {
  if (cents % 100 === 0) return String(cents / 100);
  const text = (cents / 100).toFixed(2);
  return locale() === 'de' ? text.replace('.', ',') : text;
};

/** An IBAN in groups of four */
export const formatIban = (iban: string) => iban.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();

type Rounds = { roundsUsed: number; roundsIncluded: number; giftedRounds: number; extraRounds: number; extraCents: number };

/**
 * One dot per round: the free ones first (included, then the ones the studio gave on top), used or
 * still open, then one per extra round the client ordered
 */
export function roundDots(r: Rounds) {
  const freeUsed = r.roundsUsed - r.extraRounds;
  const free = Array.from({ length: Math.max(r.roundsIncluded, freeUsed) }, (_, i) => ({
    used: i < freeUsed,
    gifted: i >= r.roundsIncluded - r.giftedRounds && i < r.roundsIncluded,
    extra: false,
  }));
  return [...free, ...Array.from({ length: r.extraRounds }, () => ({ used: true, gifted: false, extra: true }))];
}

/** "1 of 2 correction rounds used", plus the extra rounds with what they cost */
export function roundsText(r: Rounds) {
  const u = t().delivery.utils;
  const freeUsed = r.roundsUsed - r.extraRounds;
  const gifted = r.giftedRounds ? u.gifted(r.giftedRounds) : '';
  const extra = r.extraRounds ? `${u.extraRounds(r.extraRounds)} (${formatEuro(r.extraCents, locale())})` : '';
  if (r.roundsIncluded > 0) return `${u.roundsUsedOf(freeUsed, r.roundsIncluded)}${gifted}${extra ? ` + ${extra}` : ''}`;
  if (freeUsed > 0) return `${u.roundsUsedNoneIncluded(u.rounds(freeUsed))}${extra ? ` + ${extra}` : ''}`;
  return `${u.noRoundsIncluded}${extra ? ` · ${extra}` : ''}`;
}

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
    throw new GuestError(t().delivery.utils.noConnection, 0);
  }
  if (!res.ok) {
    const answer = errorAnswer.safeParse(await res.json().catch(() => null)).data;
    const message = answer?.code
      ? answer.error
      : res.status === 429
        ? t().delivery.utils.tooMany
        : res.status === 410
          ? DELIVERY_ERRORS[locale()].unavailable
          : t().delivery.utils.failed;
    throw new GuestError(message, res.status, answer?.code, answer?.extraRoundCents);
  }
  return res.json();
}
