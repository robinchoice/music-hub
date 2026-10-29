import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The terms are public only while plans are for sale (lib/billing.ts in the API)
export const load: PageServerLoad = async ({ fetch }) => {
  const res = await fetch('/api/v1/billing/offer').catch(() => null);
  const offer: { forSale: boolean } | null = res?.ok ? await res.json() : null;
  if (!offer?.forSale) error(404, 'Not found');
};
