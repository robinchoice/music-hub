import { pickLocale } from '@music-hub/shared';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { messages } from './messages.js';

// The language of a request: the web's choice from its footer (cookie), else
// Accept-Language. Plugin and CLI send neither and get German.
export const locale = (c: Context) => pickLocale(getCookie(c, 'locale') ?? c.req.header('accept-language'));

// Texts in that language
export const t = (c: Context) => messages[locale(c)];

// The language a client asked for, null for clients that don't say (plugin, CLI)
export function statedLocale(c: Context) {
  const value = getCookie(c, 'locale') ?? c.req.header('accept-language');
  return value ? pickLocale(value) : null;
}
