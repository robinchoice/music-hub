import { z } from 'zod';
import { PLAN_PERIODS, PLANS, type Plan, type PlanPeriod } from '../constants/plans.js';

// Paying Music Hub for a plan (apps/api/src/lib/billing.ts). Stripe renews a subscription, Lightning
// (BTCPay) pays one month or year ahead. Either way a payment only moves users.plan_until.
//
//     GET   /billing           -> BillingView
//     POST  /billing/checkout  billingCheckoutSchema -> { url }
//     POST  /billing/portal    -> { url }   Stripe's page to change the card and see receipts
//     POST  /billing/cancel    -> BillingCancelResponse   "Verträge hier kündigen" (§ 312k BGB)
//     POST  /billing/withdraw  billingWithdrawSchema -> BillingWithdrawResponse   within 14 days (§ 356a BGB)
//     GET   /billing/offer     -> { forSale }   public: whether the terms and plans are out
//     POST  /billing/stripe    Stripe webhook
//     POST  /billing/btcpay    BTCPay webhook

export const BILLING_METHODS = ['stripe', 'lightning'] as const;
export type BillingMethod = (typeof BILLING_METHODS)[number];

export const billingCheckoutSchema = z.object({
  plan: z.enum(PLANS),
  period: z.enum(PLAN_PERIODS),
  method: z.enum(BILLING_METHODS),
  // The express request to start right away (PLAN_CONSENT); without it there is no checkout
  consent: z.boolean().default(false),
});

export const billingWithdrawSchema = z.object({ paymentId: z.uuid() });

// When the plan ends now, and what we refund by hand (pro rata, in cents)
export type BillingCancelResponse = { endsAt: string; refundCents: number };
export type BillingWithdrawResponse = { refundCents: number };
export type BillingCheckoutInput = z.infer<typeof billingCheckoutSchema>;

export type PlanPaymentStatus = 'pending' | 'paid' | 'expired';

export type PlanPaymentView = {
  id: string;
  method: BillingMethod;
  plan: Plan;
  period: PlanPeriod;
  amountCents: number;
  status: PlanPaymentStatus;
  // Where an open Lightning invoice is paid
  checkoutUrl: string | null;
  paidUntil: string | null;
  paidAt: string | null;
  createdAt: string;
  // Until when this payment can still be withdrawn from, null if not (any more)
  withdrawUntil: string | null;
  withdrawnAt: string | null;
  refundCents: number | null;
};

export type BillingView = {
  // The plan running now, null for the free one
  plan: Plan | null;
  planUntil: string | null;
  // A Stripe subscription renews the plan, until cancelled with POST /billing/cancel
  renews: boolean;
  // Plans the account may buy now, and how: one more period of the running plan only by Lightning
  canBuy: { plan: Plan; methods: BillingMethod[] }[];
  storage: { usedBytes: number; limitBytes: number };
  payments: PlanPaymentView[];
};

export const BILLING_ERROR_CODES = ['billing_unavailable', 'plan_running', 'billing_failed', 'consent_required', 'nothing_to_end'] as const;
export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];
