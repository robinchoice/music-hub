// users.plan: null is the free plan. 'solo' is called Studio in the UI and is the only plan that may
// create deliveries; the stored value stays 'solo' because deployed code and data know it by that name.
export const PLANS = ['pro', 'solo'] as const;
export type Plan = (typeof PLANS)[number];

export const PLAN_PERIODS = ['month', 'year'] as const;
export type PlanPeriod = (typeof PLAN_PERIODS)[number];

const GB = 1024 * 1024 * 1024;

// Bytes an account may upload while the plan runs. An account never gets less than its own
// storage_limit, so a plan only ever raises it and nothing is lost when it ends.
export const PLAN_STORAGE: Record<Plan, number> = { pro: 100 * GB, solo: 500 * GB };

// Gross prices in euro cents, a year costs ten months
export const PLAN_PRICES: Record<Plan, Record<PlanPeriod, number>> = {
  pro: { month: 900, year: 9000 },
  solo: { month: 2400, year: 24000 },
};

// For the German admin pages
export const PLAN_LABELS: Record<Plan | 'free', string> = { free: 'Gratis', pro: 'Pro · 9 € im Monat', solo: 'Studio · 24 € im Monat' };

// A plan with no end or an end in the future
export function activePlan(user: { plan: string | null; planUntil: Date | null }, now = new Date()): Plan | null {
  const plan = PLANS.find((p) => p === user.plan);
  return plan && (user.planUntil === null || user.planUntil > now) ? plan : null;
}
