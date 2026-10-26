import { DELIVERY_ERRORS, type DeliveryErrorCode } from '@music-hub/shared';

/**
 * A payment service outside Music Hub (the studio's wallet, the exchange rate) failed or timed out.
 * Routes answer 502 with `{ error: message, code }`. The message is German and never contains the
 * wallet connection or anything else from the request.
 */
export class PaymentServiceError extends Error {
  readonly code: DeliveryErrorCode = 'wallet_unreachable';
  readonly status = 502;

  constructor(message: string = DELIVERY_ERRORS.wallet_unreachable) {
    super(message);
    this.name = 'PaymentServiceError';
  }
}

export const RATE_UNAVAILABLE = 'Der Bitcoin-Kurs ist gerade nicht abrufbar. Bitte versuche es später erneut.';

/** Rejects with a PaymentServiceError after `ms`; a later result of `promise` is ignored. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(message === undefined ? new PaymentServiceError() : new PaymentServiceError(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
