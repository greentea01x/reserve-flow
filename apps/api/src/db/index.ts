import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

export type Db = ReturnType<typeof createDb>;

/**
 * One pool for the process. The API connects as rf_app over the direct (IPv6) Supabase host;
 * migrations use a different URL and a different role entirely — see drizzle.config.ts.
 */
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10 });
  return drizzle(pool, { schema, casing: 'snake_case' });
}

export { schema };
