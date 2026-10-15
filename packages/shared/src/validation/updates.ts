import { z } from 'zod';

// Update mails (README, „Update-Mails“): a title and the new features. Music Hub
// speaks German only, so there is one language. Drafts may be incomplete,
// sending needs a title and a feature, see updateComplete.
export const updateContentSchema = z.object({
  title: z.string().trim().max(200),
  features: z.array(z.string().trim().max(500)).max(20),
});

export type UpdateContent = z.infer<typeof updateContentSchema>;

export const updateComplete = (content: UpdateContent) => !!content.title && content.features.some(Boolean);

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
