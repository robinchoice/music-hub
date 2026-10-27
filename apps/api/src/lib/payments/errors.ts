import { DELIVERY_ERRORS, type DeliveryErrorCode, type Locale } from '@music-hub/shared';
import { messages } from '../messages.js';

// What went wrong, the route answers with the text in the client's language
export type PaymentReason = 'wallet_unreachable' | 'relay_refused' | 'rate_unavailable' | 'wallet_invalid';

/**
 * A payment service outside Music Hub (the studio's wallet, the exchange rate) failed or timed out.
 * Routes answer 502 with `{ error: text(locale), code }`. The text never contains the
 * wallet connection or anything else from the request.
 */
export class PaymentServiceError extends Error {
  readonly code: DeliveryErrorCode = 'wallet_unreachable';
  readonly status = 502;

  constructor(readonly reason: PaymentReason = 'wallet_unreachable') {
    super(reason);
    this.name = 'PaymentServiceError';
  }

  text(locale: Locale) {
    if (this.reason === 'rate_unavailable') return messages[locale].errors.rateUnavailable;
    if (this.reason === 'wallet_invalid') return messages[locale].errors.walletInvalid;
    return DELIVERY_ERRORS[locale][this.reason];
  }
}

/** Rejects with a PaymentServiceError after `ms`; a later result of `promise` is ignored. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, reason?: PaymentReason): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PaymentServiceError(reason)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
