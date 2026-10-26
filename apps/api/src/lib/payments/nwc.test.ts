import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { NWCWalletService, NWCWalletServiceKeyPair, type Nip47Method, type Nip47SingleMethod, type Nip47Transaction } from '@getalby/sdk/nwc';
import type { Server, ServerWebSocket } from 'bun';
import { PaymentServiceError } from './errors.js';
import { blockedAddress, checkReceiveOnly, connectNwc, relayProblem } from './nwc.js';

// A minimal NIP-01 relay in the test process and a wallet built with the SDK's wallet service, so the
// real client runs end to end under Bun without the network. The relay runs on localhost, which the
// API refuses for users' connections, so these tests allow local relays.
const local = { allowLocalRelays: true };

type NostrEvent = { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string };
type Filter = { ids?: string[]; kinds?: number[]; authors?: string[]; since?: number; until?: number; limit?: number } & Record<string, unknown>;
type Socket = ServerWebSocket<{ subs: Map<string, Filter[]> }>;

function matches(event: NostrEvent, filter: Filter): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#') || !Array.isArray(values)) continue;
    const tag = key.slice(1);
    if (!event.tags.some((t) => t[0] === tag && values.includes(t[1]))) return false;
  }
  return true;
}

function startRelay(): Server<{ subs: Map<string, Filter[]> }> {
  const stored: NostrEvent[] = [];
  const sockets = new Set<Socket>();
  return Bun.serve<{ subs: Map<string, Filter[]> }>({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req, { data: { subs: new Map() } })) return undefined;
      return new Response('relay', { status: 400 });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
      },
      close(ws) {
        sockets.delete(ws);
      },
      message(ws, raw) {
        const [type, ...rest] = JSON.parse(String(raw)) as [string, ...unknown[]];
        if (type === 'EVENT') {
          const event = rest[0] as NostrEvent;
          ws.send(JSON.stringify(['OK', event.id, true, '']));
          // Ephemeral kinds (20000-29999) are only passed on
          if (event.kind < 20000 || event.kind >= 30000) stored.push(event);
          for (const socket of sockets) {
            for (const [id, filters] of socket.data.subs) {
              if (filters.some((f) => matches(event, f))) socket.send(JSON.stringify(['EVENT', id, event]));
            }
          }
        } else if (type === 'REQ') {
          const [id, ...filters] = rest as [string, ...Filter[]];
          ws.data.subs.set(id, filters);
          for (const filter of filters) {
            const found = stored.filter((e) => matches(e, filter)).sort((a, b) => b.created_at - a.created_at);
            for (const event of found.slice(0, filter.limit ?? found.length)) ws.send(JSON.stringify(['EVENT', id, event]));
          }
          ws.send(JSON.stringify(['EOSE', id]));
        } else if (type === 'CLOSE') {
          ws.data.subs.delete(rest[0] as string);
        }
      },
    },
  });
}

const hex32 = () => randomBytes(32).toString('hex');
const pubkeyOf = (secret: string) => new NWCWalletServiceKeyPair(secret, '0'.repeat(64)).walletPubkey;

let relay: Server<{ subs: Map<string, Filter[]> }>;
let relayUrl: string;
const services: NWCWalletService[] = [];
const invoices = new Map<string, Nip47Transaction>();
const requests: { method: string; params: unknown }[] = [];
let invoiceAmountOffset = 0;

const transaction = (amount: number, description: string, expiry: number): Nip47Transaction => {
  const now = Math.floor(Date.now() / 1000);
  return {
    type: 'incoming',
    state: 'pending',
    invoice: `lnbc${amount}n1test${invoices.size}`,
    description,
    description_hash: '',
    preimage: '',
    payment_hash: randomBytes(32).toString('hex'),
    amount,
    fees_paid: 0,
    settled_at: 0,
    created_at: now,
    expires_at: now + expiry,
  };
};

/** A wallet on the test relay with the given methods; returns its connection URL. */
async function wallet(methods: Nip47Method[], alias = 'Studio Klanglabor'): Promise<string> {
  const walletSecret = hex32();
  const clientSecret = hex32();
  const keypair = new NWCWalletServiceKeyPair(walletSecret, pubkeyOf(clientSecret));
  const service = new NWCWalletService({ relayUrls: [relayUrl] });
  services.push(service);
  await service.publishWalletServiceInfoEvent(walletSecret, methods.filter((m): m is Nip47SingleMethod => !m.startsWith('multi_')), []);
  await service.subscribe(keypair, {
    getInfo: async () => {
      requests.push({ method: 'get_info', params: {} });
      return {
        result: { alias, color: '', pubkey: keypair.walletPubkey, network: 'mainnet', block_height: 1, block_hash: '', methods },
        error: undefined,
      };
    },
    makeInvoice: async (request) => {
      requests.push({ method: 'make_invoice', params: request });
      const tx = transaction(request.amount + invoiceAmountOffset, request.description ?? '', request.expiry ?? 3600);
      invoices.set(tx.payment_hash, tx);
      return { result: tx, error: undefined };
    },
    lookupInvoice: async (request) => {
      requests.push({ method: 'lookup_invoice', params: request });
      const tx = request.payment_hash ? invoices.get(request.payment_hash) : undefined;
      if (!tx) return { result: undefined, error: { code: 'NOT_FOUND', message: 'invoice not found' } };
      return { result: tx, error: undefined };
    },
  });
  return `nostr+walletconnect://${keypair.walletPubkey}?relay=${encodeURIComponent(relayUrl)}&secret=${clientSecret}`;
}

beforeAll(() => {
  relay = startRelay();
  relayUrl = `ws://localhost:${relay.port}`;
});

afterEach(() => {
  invoiceAmountOffset = 0;
  requests.length = 0;
});

afterAll(() => {
  for (const service of services) service.close();
  relay.stop(true);
});

test('reads info, makes and looks up an invoice over a relay', async () => {
  const url = await wallet(['get_info', 'make_invoice', 'lookup_invoice']);
  const client = await connectNwc(url, local);
  try {
    const info = await client.getInfo();
    expect(info).toEqual({ alias: 'Studio Klanglabor', methods: ['get_info', 'make_invoice', 'lookup_invoice'] });
    expect(checkReceiveOnly(info)).toEqual({ ok: true });

    const invoice = await client.makeInvoice({ amountMsats: 800_000_000, description: 'Album · Music Hub', expirySeconds: 900 });
    expect(requests.at(-1)).toEqual({
      method: 'make_invoice',
      params: { amount: 800_000_000, description: 'Album · Music Hub', expiry: 900 },
    });
    expect(invoice.amountMsats).toBe(800_000_000);
    expect(invoice.paymentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(invoice.invoice.startsWith('lnbc')).toBe(true);
    expect(invoice.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 800_000);

    expect(await client.lookupInvoice(invoice.paymentHash)).toEqual({ settled: false, settledAt: null });
    const tx = invoices.get(invoice.paymentHash)!;
    tx.state = 'settled';
    tx.settled_at = 1_800_000_000;
    expect(await client.lookupInvoice(invoice.paymentHash)).toEqual({ settled: true, settledAt: new Date(1_800_000_000_000) });
  } finally {
    client.close();
  }
}, 20_000);

test('refuses an invoice over another amount and wallet errors', async () => {
  const url = await wallet(['make_invoice', 'lookup_invoice']);
  const client = await connectNwc(url, local);
  try {
    invoiceAmountOffset = 1000;
    await expect(client.makeInvoice({ amountMsats: 1_000_000, description: 'x', expirySeconds: 900 })).rejects.toBeInstanceOf(PaymentServiceError);
    const err = await client.lookupInvoice('f'.repeat(64)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentServiceError);
    expect((err as PaymentServiceError).code).toBe('wallet_unreachable');
  } finally {
    client.close();
  }
}, 20_000);

test('a malformed URL fails without quoting the secret', async () => {
  const secret = hex32();
  for (const url of [
    `nostr+walletconnect://nothex?relay=${encodeURIComponent(relayUrl)}&secret=${secret}`,
    `nostr+walletconnect://${hex32()}?secret=${secret}`,
    `nostr+walletconnect://${hex32()}?relay=${encodeURIComponent(relayUrl)}`,
    `nostr+walletconnect://${hex32()}?relay=not%20a%20url&secret=${secret}`,
  ]) {
    const err = await connectNwc(url, local).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentServiceError);
    expect(String((err as Error).message)).not.toContain(secret);
    expect(String((err as Error).stack)).not.toContain(secret);
  }
});

test('an unreachable relay fails fast', async () => {
  const closed = Bun.serve({ port: 0, fetch: () => new Response('') });
  const port = closed.port;
  closed.stop(true);
  const err = await connectNwc(`nostr+walletconnect://${hex32()}?relay=${encodeURIComponent(`ws://localhost:${port}`)}&secret=${hex32()}`, {
    ...local,
    timeoutMs: 2000,
  }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PaymentServiceError);
});

test('a silent relay times out', async () => {
  const silent = Bun.serve<undefined>({
    port: 0,
    fetch: (req, server) => (server.upgrade(req, { data: undefined }) ? undefined : new Response('', { status: 400 })),
    websocket: { message() {} },
  });
  try {
    const client = await connectNwc(
      `nostr+walletconnect://${hex32()}?relay=${encodeURIComponent(`ws://localhost:${silent.port}`)}&secret=${hex32()}`,
      { ...local, timeoutMs: 300 },
    );
    const started = Date.now();
    await expect(client.getInfo()).rejects.toBeInstanceOf(PaymentServiceError);
    expect(Date.now() - started).toBeLessThan(2000);
    client.close();
  } finally {
    silent.stop(true);
  }
});

test('only receive-only connections pass', () => {
  expect(checkReceiveOnly({ alias: null, methods: ['make_invoice', 'lookup_invoice'] })).toEqual({ ok: true });
  expect(
    checkReceiveOnly({ alias: null, methods: ['get_info', 'get_balance', 'make_invoice', 'lookup_invoice', 'list_transactions'] }),
  ).toEqual({ ok: true });
  expect(
    checkReceiveOnly({
      alias: null,
      methods: ['make_invoice', 'lookup_invoice', 'pay_invoice', 'pay_keysend', 'multi_pay_invoice', 'multi_pay_keysend'],
    }),
  ).toEqual({ ok: false, refused: ['pay_invoice', 'pay_keysend', 'multi_pay_invoice', 'multi_pay_keysend'], missing: [] });
  // Unknown or future methods are refused too
  expect(checkReceiveOnly({ alias: null, methods: ['make_invoice', 'lookup_invoice', 'create_connection', 'sign_message'] })).toEqual({
    ok: false,
    refused: ['create_connection', 'sign_message'],
    missing: [],
  });
  expect(checkReceiveOnly({ alias: null, methods: ['make_invoice', 'get_info'] })).toEqual({ ok: false, refused: [], missing: ['lookup_invoice'] });
  expect(checkReceiveOnly({ alias: null, methods: [] })).toEqual({ ok: false, refused: [], missing: ['make_invoice', 'lookup_invoice'] });
});

test('only public wss:// relays are dialed, nothing inside the server network', async () => {
  const at = (relay: string) => `nostr+walletconnect://${hex32()}?relay=${encodeURIComponent(relay)}&secret=${hex32()}`;
  for (const relay of [
    'ws://relay.getalby.com/v1',
    'wss://10.0.0.5:5432',
    'wss://127.0.0.1',
    'wss://2130706433',
    'wss://169.254.169.254/latest',
    'wss://100.64.1.1',
    'wss://172.20.0.3',
    'wss://192.168.1.10',
    'wss://[::1]',
    'wss://[fd00::1]',
    'wss://[fe80::1]',
    'wss://[::ffff:127.0.0.1]',
    'wss://localhost:7000',
    'wss://postgres:5432',
    'wss://api.internal',
    'wss://user:pw@relay.example.com',
  ]) {
    expect(relayProblem(at(relay))).not.toBeNull();
    const err = await connectNwc(at(relay)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentServiceError);
  }
  // Two relays: one bad one refuses the connection
  expect(relayProblem(`${at('wss://relay.getalby.com/v1')}&relay=${encodeURIComponent('wss://10.1.2.3')}`)).not.toBeNull();
  expect(relayProblem(`nostr+walletconnect://${hex32()}?secret=${hex32()}`)).not.toBeNull();
  expect(relayProblem(at('wss://relay.getalby.com/v1'))).toBeNull();
  expect(relayProblem(at('wss://[2a01:4f8:c0c:1234::1]'))).toBeNull();

  expect(['8.8.8.8', '1.1.1.1', '2a01:4f8::1'].map(blockedAddress)).toEqual([false, false, false]);
  expect(['10.0.0.1', '127.0.0.53', '169.254.169.254', '100.100.100.100', '::1', 'fc00::1', '::ffff:7f00:1', '0.0.0.0'].map(blockedAddress)).toEqual(
    Array(8).fill(true),
  );
});
