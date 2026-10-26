import { z } from 'zod';

// Empty optional settings keep their existing defaults. Validation errors name
// fields only; they must never include credentials or connection strings.
const unset = z.literal('');
const port = z.string().regex(/^\d+$/).refine((value) => Number(value) <= 65535);
const duration = z.string().regex(/^\d+$/);
const envSchema = z.object({
  DATABASE_URL: z.url(),
  APP_URL: z.url().or(unset).exactOptional(),
  S3_ENDPOINT: z.url().or(unset).exactOptional(),
  PORT: port.or(unset).exactOptional(),
  SMTP_PORT: port.or(unset).exactOptional(),
  UPDATE_MAIL_INTERVAL_MS: duration.or(unset).exactOptional(),
  SENTRY_DSN: z.url().or(unset).exactOptional(),
  // 32 random bytes as base64; encrypts the studios' wallet connections. Unset: no Lightning payments.
  PAYMENT_SECRETS_KEY: z
    .base64()
    .refine((value) => Buffer.from(value, 'base64').length === 32)
    .or(unset)
    .exactOptional(),
});

declare module 'bun' {
  interface Env extends z.infer<typeof envSchema> {}
}

const result = envSchema.safeParse(process.env);
if (!result.success) throw new Error(`Invalid environment: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
