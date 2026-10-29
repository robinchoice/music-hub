import type { PageServerLoad } from './$types';

// The section about payments only while plans are for sale (lib/billing.ts in the API)
export const load: PageServerLoad = async ({ fetch }) => {
  const res = await fetch('/api/v1/billing/offer').catch(() => null);
  const offer: { forSale: boolean } | null = res?.ok ? await res.json() : null;
  return { payments: !!offer?.forSale };
};
