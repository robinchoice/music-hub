import { z } from 'zod';
import { EXIT, Failure } from './command';
import { SLUG } from './config';
import { texts } from './texts';

const errorSchema = z.object({ error: z.string() });

// The same HTTP API as web and plugin, with the token of this device as bearer
export function createClient(url: string, token: string | undefined) {
  async function request<T extends z.ZodType>(method: string, path: string, schema: T, body?: object) {
    let res: Response;
    try {
      res = await fetch(`${url}/api/v1${path}`, {
        method,
        headers: {
          // API errors in English like the CLI's own texts
          'accept-language': 'en',
          ...(token && { authorization: `Bearer ${token}` }),
          ...(body && { 'content-type': 'application/json' }),
        },
        body: body ? JSON.stringify(body) : null,
      });
    } catch {
      throw new Failure(texts.unreachable(url), EXIT.error);
    }
    // requireAuth answers 401 with an English "Unauthorized"
    if (res.status === 401) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new Failure(errorSchema.safeParse(json).data?.error ?? texts.badAnswer, EXIT.error);
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Failure(texts.badAnswer, EXIT.error);
    return parsed.data;
  }

  return {
    get: <T extends z.ZodType>(path: string, schema: T) => request('GET', path, schema),
    post: <T extends z.ZodType>(path: string, schema: T, body: object = {}) => request('POST', path, schema, body),
    patch: <T extends z.ZodType>(path: string, schema: T, body: object) => request('PATCH', path, schema, body),
  };
}

export type Client = ReturnType<typeof createClient>;
