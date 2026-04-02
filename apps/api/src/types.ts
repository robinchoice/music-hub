import type { Database } from '@music-hub/db';

export type AppEnv = {
  Variables: {
    db: Database;
    userId: string;
  };
};
