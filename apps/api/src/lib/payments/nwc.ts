import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { NWCClient } from '@getalby/sdk/nwc';
import { DELIVERY_ERRORS } from '@music-hub/shared';
import { z } from 'zod';
import { PaymentServiceError, withTimeout } from './errors.js';

// Nostr Wallet Connect (NIP-47) to the studio's own wallet. Music Hub only asks it to make invoices
// and to look them up, money goes straight to the studio. A connection that may spend is refused.
// The connection URL holds the client secret: it never goes into a log or an error message. Every
// failure (bad URL, relay down, wallet error, timeout) throws a PaymentServiceError (502).
// The relays come from the user, so the API only dials public wss:// hosts: never loopback, private,
// link-local or CGNAT addresses, by name or by number (no requests into the server's own network).

export type NwcInfo = {
  alias: string | null;
  // NIP-47 methods the connection allows, as listed by get_info
  methods: string[];
};

export type NwcInvoice = {
  // BOLT11
  invoice: string;
  // hex, 64 characters
  paymentHash: string;
  amountMsats: number;
  expiresAt: Date | null;
};

export type NwcLookup = {
  settled: boolean;
  settledAt: Date | null;
};

export interface NwcClient {
  /** NIP-47 get_info */
  getInfo(): Promise<NwcInfo>;
  /** NIP-47 make_invoice; amount in millisats */
  makeInvoice(input: { amountMsats: number; description: string; expirySeconds: number }): Promise<NwcInvoice>;
  /** NIP-47 lookup_invoice by payment hash */
  lookupInvoice(paymentHash: string): Promise<NwcLookup>;
  /** Closes the relay connection */
  close(): void;
}

export type NwcFactory = (url: string) => Promise<NwcClient>;

// The methods a receive-only connection may list; anything else (pay_invoice, pay_keysend,
// multi_pay_invoice, multi_pay_keysend, ...) refuses it. make_invoice and lookup_invoice are required.
export const RECEIVE_ONLY_METHODS = ['make_invoice', 'lookup_invoice', 'get_info', 'get_balance', 'list_transactions'] as const;
export const REQUIRED_METHODS = ['make_invoice', 'lookup_invoice'] as const;

// Each relay round trip (connect, request and reply) gets at most this long
export const NWC_TIMEOUT_MS = 10_000;

const INVALID_URL = 'Diese Wallet-Verbindung ist ungültig.';

let factory: NwcFactory | null = null;

/** Test hook: API tests inject a fake wallet; null restores the real connection. */
export function setNwcFactory(next: NwcFactory | null): void {
  factory = next;
}

/**
 * Opens a connection for a nostr+walletconnect:// URL. Throws on a malformed URL, a relay that isn't
 * public (relayProblem) or an unreachable relay. allowLocalRelays is for tests with a relay on localhost.
 */
export async function connectNwc(url: string, options: { timeoutMs?: number; allowLocalRelays?: boolean } = {}): Promise<NwcClient> {
  const checked = options.allowLocalRelays !== true;
  if (checked && relayProblem(url)) throw new PaymentServiceError(DELIVERY_ERRORS.relay_refused);
  if (factory) return factory(url);
  return connectRelay(url, options.timeoutMs ?? NWC_TIMEOUT_MS, checked);
}

/** The relay URLs of a connection string, [] when it has none or isn't one */
export function relayUrlsOf(url: string): string[] {
  const prefix = 'nostr+walletconnect://';
  if (!url.startsWith(prefix)) return [];
  try {
    return new URL(`https://${url.slice(prefix.length)}`).searchParams.getAll('relay');
  } catch {
    return [];
  }
}

const parseIpv4 = (ip: string) => ip.split('.').map(Number);

// Addresses the API must not dial for a user: this host, private networks, link-local (cloud
// metadata), CGNAT, multicast and reserved ranges
export function blockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a = 0, b = 0, c = 0] = parseIpv4(ip);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    // An IPv4 address written as IPv6 is checked as IPv4
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (dotted) return blockedAddress(dotted[1]!);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hex) {
      const [high, low] = [Number.parseInt(hex[1]!, 16), Number.parseInt(hex[2]!, 16)];
      return blockedAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    if (lower === '::' || lower === '::1') return true;
    // Anything but global unicast (2000::/3) is out: unique local, link-local, multicast, NAT64, ...
    return !/^[23][0-9a-f]{3}:/.test(lower) || lower.startsWith('2001:db8:') || lower.startsWith('2002:');
  }
  return true;
}

/**
 * Why a connection string's relays can't be dialed, null when they can: every relay must be wss://
 * with a public host. Names are checked again after resolving them, when connecting.
 */
export function relayProblem(url: string): string | null {
  const relays = relayUrlsOf(url);
  if (relays.length === 0) return 'no relay';
  for (const relay of relays) {
    let parsed: URL;
    try {
      parsed = new URL(relay);
    } catch {
      return 'invalid relay';
    }
    if (parsed.protocol !== 'wss:') return 'relay without wss';
    if (parsed.username || parsed.password) return 'relay with credentials';
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (isIP(host)) {
      if (blockedAddress(host)) return 'relay in a private network';
    } else if (!host.includes('.') || /\.(localhost|local|internal|lan|home|arpa)$/.test(host) || host === 'localhost') {
      return 'relay with a local name';
    }
  }
  return null;
}

// Every address a relay's name resolves to must be public
async function assertPublicRelays(relays: string[]) {
  for (const relay of relays) {
    const host = new URL(relay).hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (addresses.length === 0) throw new PaymentServiceError();
    if (addresses.some((a) => blockedAddress(a.address))) throw new PaymentServiceError(DELIVERY_ERRORS.relay_refused);
  }
}

// Wallet answers are untrusted input
const infoSchema = z.object({ alias: z.string().nullish(), methods: z.array(z.string()) });
const invoiceSchema = z.object({
  invoice: z.string().min(1),
  payment_hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  amount: z.number(),
  expires_at: z.number().nullish(),
});
const lookupSchema = z.object({
  state: z.string().nullish(),
  settled_at: z.number().nullish(),
});

/** The real NIP-47 client over the URL's relay, with its secret as the client key. */
async function connectRelay(url: string, timeoutMs: number, publicOnly: boolean): Promise<NwcClient> {
  let client: NWCClient;
  try {
    client = new NWCClient({ nostrWalletConnectUrl: url, requireSecret: true });
  } catch {
    // The SDK's message may quote parts of the URL
    throw new PaymentServiceError(INVALID_URL);
  }
  const call = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await withTimeout(run(), timeoutMs);
    } catch {
      throw new PaymentServiceError();
    }
  };
  try {
    if (publicOnly) await withTimeout(assertPublicRelays(client.relayUrls), timeoutMs);
    await call(() => Promise.any(client.relayUrls.map((relay) => client.pool.ensureRelay(relay, { connectionTimeout: timeoutMs }))));
  } catch (err) {
    client.close();
    throw err;
  }

  return {
    async getInfo() {
      const parsed = infoSchema.safeParse(await call(() => client.getInfo()));
      if (!parsed.success) throw new PaymentServiceError();
      return { alias: parsed.data.alias || null, methods: parsed.data.methods };
    },
    async makeInvoice({ amountMsats, description, expirySeconds }) {
      const parsed = invoiceSchema.safeParse(await call(() => client.makeInvoice({ amount: amountMsats, description, expiry: expirySeconds })));
      // An invoice over another amount would let the client pay the wrong sum
      if (!parsed.success || parsed.data.amount !== amountMsats) throw new PaymentServiceError();
      return {
        invoice: parsed.data.invoice,
        paymentHash: parsed.data.payment_hash.toLowerCase(),
        amountMsats: parsed.data.amount,
        expiresAt: parsed.data.expires_at ? new Date(parsed.data.expires_at * 1000) : null,
      };
    },
    async lookupInvoice(paymentHash) {
      const parsed = lookupSchema.safeParse(await call(() => client.lookupInvoice({ payment_hash: paymentHash })));
      if (!parsed.success) throw new PaymentServiceError();
      const { state, settled_at } = parsed.data;
      // Older wallets have no state and only set settled_at once paid
      const settled = state ? state === 'settled' : Boolean(settled_at);
      return { settled, settledAt: settled && settled_at ? new Date(settled_at * 1000) : null };
    },
    close() {
      client.close();
    },
  };
}

/**
 * Whether a connection only receives: every listed method is in RECEIVE_ONLY_METHODS and both
 * REQUIRED_METHODS are there. `refused` names the methods that are not allowed, `missing` the required ones absent.
 */
export function checkReceiveOnly(info: NwcInfo): { ok: true } | { ok: false; refused: string[]; missing: string[] } {
  const allowed: readonly string[] = RECEIVE_ONLY_METHODS;
  const refused = [...new Set(info.methods.filter((method) => !allowed.includes(method)))];
  const missing = REQUIRED_METHODS.filter((method) => !info.methods.includes(method));
  return refused.length === 0 && missing.length === 0 ? { ok: true } : { ok: false, refused, missing };
}
