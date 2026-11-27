import { z } from 'zod';
import { EXIT, Failure } from './command';
import { SLUG } from './config';
import { texts } from './texts';

const errorSchema = z.object({ error: z.string() });

// The same HTTP API as web and plugin, with the token of this device as bearer
export function createClient(url: string, token: string | undefined) {
  async function send(method: string, path: string, body?: object) {
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
    return res;
  }
  const failure = async (res: Response) =>
    new Failure(errorSchema.safeParse(await res.json().catch(() => null)).data?.error ?? texts.badAnswer, EXIT.error);

  async function request<T extends z.ZodType>(method: string, path: string, schema: T, body?: object) {
    const res = await send(method, path, body);
    if (!res.ok) throw await failure(res);
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new Failure(texts.badAnswer, EXIT.error);
    return parsed.data;
  }

  return {
    get: <T extends z.ZodType>(path: string, schema: T) => request('GET', path, schema),
    post: <T extends z.ZodType>(path: string, schema: T, body: object = {}) => request('POST', path, schema, body),
    patch: <T extends z.ZodType>(path: string, schema: T, body: object) => request('PATCH', path, schema, body),
    put: <T extends z.ZodType>(path: string, schema: T, body: object) => request('PUT', path, schema, body),
    // A file the API streams itself, such as a ZIP
    file: async (path: string) => {
      const res = await send('GET', path);
      if (!res.ok) throw await failure(res);
      return res;
    },
  };
}

export type Client = ReturnType<typeof createClient>;
