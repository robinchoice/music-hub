import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Studio wallet connections (NWC URLs) are stored encrypted with AES-256-GCM. The key is
// PAYMENT_SECRETS_KEY, 32 bytes as base64 (env.ts checks the format). Without it, no wallet can be
// connected: PUT /payment-account answers 503 'lightning_unconfigured'.

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Whether PAYMENT_SECRETS_KEY is set, so Lightning can be offered at all. */
export function paymentsConfigured(): boolean {
  return Boolean(process.env.PAYMENT_SECRETS_KEY);
}

function key(): Buffer {
  const value = process.env.PAYMENT_SECRETS_KEY;
  if (!value) throw new Error('PAYMENT_SECRETS_KEY is not set');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32) throw new Error('PAYMENT_SECRETS_KEY must be 32 bytes');
  return bytes;
}

/**
 * Encrypts `plain` with AES-256-GCM under PAYMENT_SECRETS_KEY and a fresh random 12-byte IV.
 * Returns a self-contained string for payment_accounts.nwc_secret_enc: `v1.<iv>.<ciphertext+tag>`
 * in base64url, the version is bound as additional data. Throws if the key is not set.
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(VERSION));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${iv.toString('base64url')}.${body.toString('base64url')}`;
}

/**
 * Reverses encryptSecret. Throws if the key is not set, the format is unknown or the tag does not match.
 */
export function decryptSecret(encrypted: string): string {
  const [version, ivPart, bodyPart, ...rest] = encrypted.split('.');
  if (version !== VERSION || ivPart === undefined || bodyPart === undefined || rest.length > 0) {
    throw new Error('Unknown secret format');
  }
  const iv = Buffer.from(ivPart, 'base64url');
  const body = Buffer.from(bodyPart, 'base64url');
  if (iv.length !== IV_BYTES || body.length < TAG_BYTES) throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(), iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(VERSION));
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString('utf8');
}
