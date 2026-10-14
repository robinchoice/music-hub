import { z } from 'zod';

export const createCommentSchema = z.object({
  body: z.string().min(1).max(5000),
  timestampSeconds: z.number().nonnegative().optional(),
  parentId: z.string().uuid().optional(),
});

export const updateCommentSchema = z.object({
  body: z.string().min(1).max(5000),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

// "Fertig mit V4": closes your listening pass with a verdict. Only who may approve can "approve";
// guests on a share link choose from the other three.
export const REVIEW_VERDICTS = ['approve', 'fine', 'changes', 'notes'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

// Whoever forgets "Fertig" still reaches the uploader once they have been quiet this long. A pass only
// holds comments younger than REVIEW_PASS_HOURS, so threads from before stay out of it.
export const REVIEW_QUIET_MINUTES = 15;
export const REVIEW_PASS_HOURS = 2;

export const createReviewSchema = z.object({
  verdict: z.enum(REVIEW_VERDICTS),
  note: z.string().trim().max(2000).optional(),
});

export const guestReviewSchema = z.object({
  verdict: z.enum(['fine', 'changes', 'notes']),
  note: z.string().trim().max(2000).optional(),
  guestName: z.string().min(1).max(100),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type GuestReviewInput = z.infer<typeof guestReviewSchema>;
