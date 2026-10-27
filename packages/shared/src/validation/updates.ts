import { z } from 'zod';
import type { Locale } from '../i18n.js';

// Update mails (README, „Update-Mails“): a title and the new features. German
// stays at the top level as before, English sits next to it in en; updates from
// before have none. Drafts may be incomplete, sending needs a title and a
// feature in both languages, see updateComplete.
const languageContent = z.object({
  title: z.string().trim().max(200),
  features: z.array(z.string().trim().max(500)).max(20),
});

export const updateContentSchema = languageContent.extend({ en: languageContent.optional() });

export type UpdateContent = z.infer<typeof updateContentSchema>;
type LanguageContent = z.infer<typeof languageContent>;

const filled = (content: LanguageContent) => !!content.title && content.features.some(Boolean);

export const updateComplete = (content: UpdateContent) => filled(content) && !!content.en && filled(content.en);

// The text a recipient reads: their language, German for updates without English
export const updateIn = (content: UpdateContent, locale: Locale): LanguageContent =>
  locale === 'en' && content.en && filled(content.en) ? content.en : { title: content.title, features: content.features };

export const saveUpdateSchema = z.object({
  content: updateContentSchema,
  // PNG or JPEG up to about 2 MB as base64, null removes it, missing keeps it
  image: z.string().base64().max(2_800_000).nullable().optional(),
});

export type UpdateSummary = {
  id: string;
  // File name in updates/ for drafts written by agents
  slug: string | null;
  content: UpdateContent;
  hasImage: boolean;
  createdAt: string;
  sentAt: string | null;
  // Deliveries of a sent update
  sent: number;
  failed: number;
  pending: number;
};
