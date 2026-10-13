import type { PageServerLoad } from './$types';

// The nav renders signed in from the start instead of flipping once checkAuth() answers
export const load: PageServerLoad = async ({ fetch, cookies }) => {
  if (!cookies.get('session')) return { signedIn: false };
  const res = await fetch('/api/v1/auth/me').catch(() => null);
  if (!res?.ok) return { signedIn: false };
  const { user }: { user: unknown } = await res.json();
  return { signedIn: !!user };
};
