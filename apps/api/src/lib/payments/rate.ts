import { z } from 'zod';
import { PaymentServiceError, RATE_UNAVAILABLE } from './errors.js';

// Euro to sats for Lightning invoices, from https://mempool.space/api/v1/prices (field EUR, euro per
// bitcoin), cached for 60 seconds. Failures throw a PaymentServiceError (502).

export type PriceSource = () => Promise<number>;

const PRICES_URL = 'https://mempool.space/api/v1/prices';
const CACHE_MS = 60_000;
const TIMEOUT_MS = 10_000;

const pricesSchema = z.object({ EUR: z.number().positive() });

let source: PriceSource | null = null;
let cached: { price: number; at: number } | null = null;

/** Test hook: a fixed price in euro per bitcoin instead of mempool.space; null restores it. */
export function setPriceSource(next: PriceSource | null): void {
  source = next;
  cached = null;
}

/** The current price source; the real one fetches mempool.space. */
export function priceSource(): PriceSource {
  return source ?? fetchEurPrice;
}

async function fetchEurPrice(): Promise<number> {
  let body: unknown;
  try {
    const res = await fetch(PRICES_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new PaymentServiceError(RATE_UNAVAILABLE);
    body = await res.json();
  } catch {
    throw new PaymentServiceError(RATE_UNAVAILABLE);
  }
  const parsed = pricesSchema.safeParse(body);
  if (!parsed.success) throw new PaymentServiceError(RATE_UNAVAILABLE);
  return parsed.data.EUR;
}

async function eurPerBtc(): Promise<number> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.price;
  let price: number;
  try {
    price = await priceSource()();
  } catch (err) {
    throw err instanceof PaymentServiceError ? err : new PaymentServiceError(RATE_UNAVAILABLE);
  }
  if (!Number.isFinite(price) || price <= 0) throw new PaymentServiceError(RATE_UNAVAILABLE);
  cached = { price, at: now };
  return price;
}

/** Sats for an amount in euro cents, rounded up, at the cached price (at most 60 seconds old). */
export async function eurToSats(cents: number): Promise<number> {
  const price = await eurPerBtc();
  // cents / 100 euro at `price` euro per bitcoin, 1e8 sats per bitcoin
  return Math.ceil((cents * 1_000_000) / price);
}
