import { z } from 'zod';

// Deliveries (Aufträge): a studio attaches an order to its own project link. The client approves each
// song or asks for a correction round, pays the total to the studio once every song is approved, and
// only then downloads the originals. Amounts are euro cents everywhere.
//
// Routes (all under /api/v1):
//   Studio (requireAuth, project owner):
//     GET    /deliveries/project/:projectId                          -> DeliveryListResponse
//     POST   /deliveries/project/:projectId      createDeliverySchema -> 201 DeliveryResponse
//     GET    /deliveries/:deliveryId                                 -> DeliveryResponse
//     PATCH  /deliveries/:deliveryId             updateDeliverySchema -> DeliveryResponse
//     POST   /deliveries/:deliveryId/cancel                          -> DeliveryResponse
//     POST   /deliveries/:deliveryId/tracks/:trackId/gift  giftRoundSchema -> DeliveryResponse
//     POST   /deliveries/:deliveryId/payments/:paymentId/confirm     -> DeliveryResponse (any payment not
//            paid yet: a transfer that arrived, or a Lightning payment the wallet got but nobody saw)
//   Payment account (requireAuth, own account):
//     GET    /payment-account                                        -> PaymentAccountResponse
//     PUT    /payment-account                    paymentAccountSchema -> PaymentAccountResponse
//   Admin (adminRoutes, requireAuth + requireAdmin):
//     PATCH  /admin/users/:id/plan               adminPlanSchema      -> AdminPlanResponse
//   Guest (no account; X-Share-Password header like the project link):
//     GET    /share/project/public/:token                            -> ProjectPublicDeliveryFields (added to the existing answer)
//     POST   /share/project/public/:token/delivery/rounds   deliveryRoundSchema   -> 201 GuestDeliveryResponse
//     POST   /share/project/public/:token/delivery/approve  deliveryApproveSchema -> GuestDeliveryResponse
//     POST   /share/project/public/:token/delivery/payments createPaymentSchema   -> 201 GuestPaymentResponse
//     GET    /share/project/public/:token/delivery/payments/:paymentId           -> GuestPaymentResponse
//     POST   /share/project/public/:token/delivery/payments/:paymentId/announce  -> GuestPaymentResponse
//     GET    /share/project/public/:token/delivery/download/:trackId             -> 302 to a short-lived URL of the approved original
//     GET    /share/project/public/:token/delivery/download/:trackId/stems       -> 200 application/zip
// Errors answer DeliveryErrorResponse.

export const DELIVERY_STATUSES = ['open', 'paid', 'cancelled'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const PAYMENT_METHODS = ['lightning', 'transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'announced', 'paid', 'expired'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// What the client sees per song: their turn, the studio's turn after a round, or approved
export const DELIVERY_TRACK_STATES = ['review', 'changes', 'approved'] as const;
export type DeliveryTrackState = (typeof DELIVERY_TRACK_STATES)[number];

// users.plan: null is the free plan. Only 'solo' (19 €/month) may create deliveries.
export const PLANS = ['solo'] as const;
export type Plan = (typeof PLANS)[number];
export const PLAN_LABELS: Record<Plan | 'free', string> = { free: 'Gratis', solo: 'Solo · 19 € im Monat' };

export const DEFAULT_INCLUDED_ROUNDS = 2;
// A Lightning invoice from the studio's wallet stays valid this long
export const LIGHTNING_INVOICE_SECONDS = 900;

// Machine-readable reason next to the German error text
export const DELIVERY_ERROR_CODES = [
  'plan_required',
  'delivery_exists',
  'track_invalid',
  'not_open',
  'unavailable',
  'moved_on',
  'round_exists',
  'extra_round',
  'not_payable',
  'method_unavailable',
  'payment_closed',
  'not_paid',
  'lightning_unconfigured',
  'wallet_spends',
  'wallet_unreachable',
  'invalid_iban',
  'relay_refused',
  'track_open',
  'link_has_delivery',
  'already_paid',
  'zip_too_large',
] as const;
export type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[number];

// The texts the API sends with each code; the web shows `error` as it is
export const DELIVERY_ERRORS: Record<DeliveryErrorCode, string> = {
  plan_required: 'Aufträge gibt es mit dem Solo-Tarif.',
  delivery_exists: 'Für diesen Link gibt es schon einen Auftrag.',
  track_invalid: 'Dieser Song gehört nicht zum Projekt-Link.',
  not_open: 'Dieser Auftrag ist abgeschlossen.',
  unavailable: 'Dieser Link ist gerade nicht verfügbar.',
  moved_on: 'Inzwischen gibt es eine neuere Version. Lade die Seite neu, um sie zu hören.',
  round_exists: 'Für diese Version sind schon Änderungen angefordert. Das Studio meldet sich mit einer neuen Version.',
  extra_round: 'Das wäre eine kostenpflichtige Zusatzrunde. Bitte bestätige sie.',
  not_payable: 'Bezahlen geht, sobald alle Songs freigegeben sind.',
  method_unavailable: 'Diese Zahlungsart bietet das Studio nicht an.',
  payment_closed: 'Diese Zahlung ist nicht mehr offen.',
  not_paid: 'Den Download gibt es nach der Zahlung.',
  lightning_unconfigured: 'Lightning ist auf diesem Server noch nicht eingerichtet',
  wallet_spends: 'Diese Wallet-Verbindung darf auch bezahlen. Bitte erstelle eine, die nur Rechnungen ausstellen und prüfen darf.',
  wallet_unreachable: 'Die Wallet antwortet gerade nicht. Bitte versuche es später erneut.',
  invalid_iban: 'Diese IBAN ist nicht gültig.',
  relay_refused: 'Dieses Relay ist nicht erlaubt. Die Wallet-Verbindung braucht ein öffentliches Relay mit wss://.',
  track_open: 'Offene Tracks lassen sich nicht abliefern, ihr Original und ihre Spuren sind öffentlich.',
  link_has_delivery: 'An diesem Link hängt ein offener oder bezahlter Auftrag. Einen offenen kannst du erst stornieren.',
  already_paid: 'Die Zahlung ist schon angekommen. Lade die Seite neu, um herunterzuladen.',
  zip_too_large: 'Die Spuren sind zu groß für ein ZIP. Bitte frag das Studio nach einem anderen Weg.',
};

// "1.234,50 €"
export const formatEuro = (cents: number) =>
  (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 === 0 ? 0 : 2 });

export type DeliveryErrorResponse = {
  error: string;
  code?: DeliveryErrorCode;
  // With code 'extra_round': what the confirmed round would cost
  extraRoundCents?: number;
};

// ---------- Requests ----------

const cents = z.number().int().min(0).max(10_000_000);
const rounds = z.number().int().min(0).max(20);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const deliveryTrackInputSchema = z.object({
  trackId: z.string().uuid(),
  priceCents: cents,
});

// The owner's project link is used, or made like POST /share/project/:projectId; it takes comments.
// Every track must belong to the project and, if the link has a selection, be in it.
export const createDeliverySchema = z.object({
  clientName: z.string().trim().min(1).max(255),
  clientEmail: z.string().trim().email().max(255).nullable().optional(),
  reference: optionalText(64),
  includedRounds: rounds.optional(),
  extraRoundCents: cents.optional(),
  includeStems: z.boolean().optional(),
  tracks: z.array(deliveryTrackInputSchema).min(1).max(200),
});

// While open. tracks, when given, is the full list: new ones join, missing ones leave the delivery
// (their rounds stay stored but no longer count). Changing the total expires an open payment.
export const updateDeliverySchema = z.object({
  clientName: z.string().trim().min(1).max(255).optional(),
  clientEmail: z.string().trim().email().max(255).nullable().optional(),
  reference: optionalText(64),
  includedRounds: rounds.optional(),
  extraRoundCents: cents.optional(),
  includeStems: z.boolean().optional(),
  tracks: z.array(deliveryTrackInputSchema).min(1).max(200).optional(),
});

// One free round more for a song, or `rounds` of them
export const giftRoundSchema = z.object({
  rounds: z.number().int().min(1).max(10).optional(),
});

// undefined keeps a value, null clears it. iban and accountHolder go together; bic is optional.
// nwcUrl is a nostr+walletconnect:// string; it is checked with get_info and stored encrypted.
export const paymentAccountSchema = z.object({
  nwcUrl: z.string().trim().startsWith('nostr+walletconnect://').max(2000).nullable().optional(),
  iban: z.string().trim().max(42).nullable().optional(),
  bic: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/)
    .nullable()
    .optional(),
  accountHolder: z.string().trim().min(1).max(70).nullable().optional(),
});

export const adminPlanSchema = z.object({
  plan: z.enum(PLANS).nullable(),
  // ISO date-time; null or missing means open-ended
  planUntil: z.string().datetime().nullable().optional(),
});

const guestName = z.string().trim().min(1).max(100);

// "Änderungen anfordern": closes the client's pass on the version they heard as a review with verdict
// 'changes' and counts one round. An extra round needs confirmExtra: true ("Zahlungspflichtig beauftragen")
// and extraRoundCents, the price on the button; at any other price it is refused with the current one.
export const deliveryRoundSchema = z.object({
  trackId: z.string().uuid(),
  versionId: z.string().uuid(),
  guestName,
  note: z.string().trim().max(2000).optional(),
  confirmExtra: z.boolean().optional(),
  extraRoundCents: cents.optional(),
});

export const deliveryApproveSchema = z.object({
  trackId: z.string().uuid(),
  versionId: z.string().uuid(),
  guestName,
  note: z.string().trim().max(2000).optional(),
});

export const createPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
});

export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
export type UpdateDeliveryInput = z.infer<typeof updateDeliverySchema>;
export type GiftRoundInput = z.infer<typeof giftRoundSchema>;
export type PaymentAccountInput = z.infer<typeof paymentAccountSchema>;
export type AdminPlanInput = z.infer<typeof adminPlanSchema>;
export type DeliveryRoundInput = z.infer<typeof deliveryRoundSchema>;
export type DeliveryApproveInput = z.infer<typeof deliveryApproveSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

// ---------- Responses (dates are ISO strings) ----------

export type DeliveryTotals = {
  songsCents: number;
  extraRounds: number;
  // What the next extra round costs
  extraRoundCents: number;
  // The extra rounds so far, each at the price the client confirmed
  extraCents: number;
  // songsCents + extraCents
  totalCents: number;
  // Payments that arrived, also ones made before the total changed (e.g. a replaced invoice paid late)
  paidCents: number;
  // What is left to pay: totalCents - paidCents, never below 0. Once every song is approved and
  // nothing is due, the delivery is paid.
  dueCents: number;
  approvedCount: number;
  trackCount: number;
};

export type PublicDeliveryTrack = {
  trackId: string;
  priceCents: number;
  // Rounds asked for so far, extra ones included
  roundsUsed: number;
  // included_rounds + gifted_rounds
  roundsIncluded: number;
  // Of roundsIncluded, the ones the studio gave on top
  giftedRounds: number;
  extraRounds: number;
  // The song's extra rounds at their confirmed prices
  extraCents: number;
  // The next round would cost extraRoundCents
  nextRoundExtra: boolean;
  // The version the track's link shows now, null while there is none
  shownVersionId: string | null;
  approvedVersionId: string | null;
  approvedByName: string | null;
  state: DeliveryTrackState;
  // Whether a stems ZIP comes with the download (includeStems and the track has stems)
  hasStems: boolean;
};

export type PublicTransferDetails = {
  accountHolder: string;
  iban: string;
  bic: string | null;
  // Verwendungszweck: reference, or "MH-" and the first 8 characters of the delivery id
  remittance: string;
  // EPC069-12 payload for the GiroCode
  epcPayload: string;
};

export type PublicPayment = {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  sats: number | null;
  // BOLT11, Lightning only
  invoice: string | null;
  expiresAt: string | null;
  // Transfer only
  transfer: PublicTransferDetails | null;
  createdAt: string;
  paidAt: string | null;
};

// The optional `delivery` field of GET /share/project/public/:token, absent without a delivery or
// when it was cancelled
export type PublicDelivery = {
  id: string;
  status: DeliveryStatus;
  clientName: string;
  // Name of the account that made the delivery
  studioName: string;
  reference: string | null;
  includeStems: boolean;
  extraRoundCents: number;
  tracks: PublicDeliveryTrack[];
  totals: DeliveryTotals;
  // Open, every song approved and something due
  payable: boolean;
  methods: { lightning: boolean; transfer: boolean };
  // The pending or announced payment, null without one. An announced transfer stays open when a
  // round changes the total; the studio still confirms it and it counts as paid.
  openPayment: PublicPayment | null;
  // Paid: the download routes answer
  downloads: boolean;
  paidAt: string | null;
};

// Fields GET /share/project/public/:token adds. With a delivery that isn't cancelled, allowDownload is
// always false there and in the track links.
export type ProjectPublicDeliveryFields = {
  delivery?: PublicDelivery;
};

// Field GET /share/public/:token adds: behind a delivery the original never streams, so a version
// without MP3 answers streamUrl null and processing true ("wird vorbereitet"); downloadUrl is null.
export type SharePublicPaywallFields = {
  processing?: boolean;
};

export type GuestDeliveryResponse = { delivery: PublicDelivery };
export type GuestPaymentResponse = { payment: PublicPayment; delivery: PublicDelivery };

export type StudioDeliveryTrack = PublicDeliveryTrack & {
  name: string;
  shownVersionNumber: number | null;
  approvedAt: string | null;
};

export type StudioDeliveryRound = {
  id: string;
  trackId: string;
  // null once the version was purged from the trash; the round still counts
  versionId: string | null;
  versionNumber: number;
  guestName: string | null;
  extra: boolean;
  priceCents: number;
  createdAt: string;
};

export type StudioPayment = {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  sats: number | null;
  expiresAt: string | null;
  confirmedByName: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type StudioDelivery = {
  id: string;
  projectId: string;
  projectLinkId: string;
  // Token of the project link; the client opens /album/<token>
  linkToken: string;
  createdById: string;
  status: DeliveryStatus;
  clientName: string;
  clientEmail: string | null;
  reference: string | null;
  includedRounds: number;
  extraRoundCents: number;
  includeStems: boolean;
  tracks: StudioDeliveryTrack[];
  rounds: StudioDeliveryRound[];
  // Newest first
  payments: StudioPayment[];
  totals: DeliveryTotals;
  payable: boolean;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryResponse = { delivery: StudioDelivery };
// Newest first, cancelled ones included
export type DeliveryListResponse = { deliveries: StudioDelivery[]; canCreate: boolean };

export type PaymentAccount = {
  // PAYMENT_SECRETS_KEY is set, so a wallet can be connected
  lightningAvailable: boolean;
  lightning: { connected: boolean; alias: string | null };
  // ibanMasked shows only the last 4 characters, e.g. "•••• •••• •••• •••• 1234"
  transfer: { ibanMasked: string; bic: string | null; accountHolder: string } | null;
  updatedAt: string | null;
};

export type PaymentAccountResponse = { account: PaymentAccount };

export type AdminPlanResponse = { plan: Plan | null; planUntil: string | null };
