// The languages Music Hub speaks, German first as the default
export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const dateLocales: Record<Locale, string> = { de: 'de-DE', en: 'en-GB' };

// The first language from a saved choice or an Accept-Language header that we
// speak, else German. Browsers list their languages by preference.
export function pickLocale(value: string | null | undefined): Locale {
  for (const part of value?.split(',') ?? []) {
    const lang = part.trim().slice(0, 2).toLowerCase();
    if ((LOCALES as readonly string[]).includes(lang)) return lang as Locale;
  }
  return 'de';
}
