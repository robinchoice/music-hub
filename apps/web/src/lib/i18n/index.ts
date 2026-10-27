import { dateLocales, type Locale } from '@music-hub/shared';
import { refreshAll } from '$app/navigation';
import { page } from '$app/state';
import { checkAuth } from '$lib/stores/auth.js';
import { messages } from './messages.js';

// The current language. hooks.server.ts takes it from the cookie, else from the browser.
export const locale = (): Locale => page.data.locale ?? 'de';

// Texts in the current language, e.g. {t().common.save}
export const t = () => messages[locale()];

// For toLocaleString and co.: 'de-DE' or 'en-GB'
export const dateLocale = () => dateLocales[locale()];

export async function setLocale(next: Locale) {
  document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`;
  await refreshAll();
  document.documentElement.lang = next;
  // /auth/me stores the language for mails and pushes to a signed-in account
  await checkAuth();
}
