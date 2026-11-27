import { z } from 'zod';

// What the web sends along with feedback on the app. The API adds its own version.
export const appFeedbackContextSchema = z.object({
  platform: z.enum(['web', 'ios', 'android']),
  page: z.string().max(500),
  // App build; the web runs the same commit as the API
  version: z.string().max(100).optional(),
  device: z.string().max(300),
  viewport: z.string().max(50),
  locale: z.string().max(10),
  // Failed API calls as "METHOD /path → status", newest first
  errors: z.array(z.string().max(300)).max(5),
});

export type AppFeedbackContext = z.infer<typeof appFeedbackContextSchema>;

export const appFeedbackSchema = z.object({
  kind: z.enum(['bug', 'idea']),
  message: z.string().trim().min(5).max(5000),
  // PNG or JPEG, up to about 5 MB
  screenshot: z.base64().max(7_000_000).optional(),
  context: appFeedbackContextSchema,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Share, album and upload links carry their token in the path, and the issue is public.
// Long random segments become "…", ids of projects and tracks stay.
export const withoutTokens = (path: string) =>
  path.replace(/[A-Za-z0-9_-]{16,}/g, (segment) => (UUID.test(segment) ? segment : '…'));
