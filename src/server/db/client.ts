import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

// One shared pool for the process. The pool is lazy — it doesn't connect until
// the first query — so importing this module never fails just because the DB
// is down (e.g. SSR can still render pages without the API working).
export const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

export const db = drizzle(pool, { schema });
export { schema };
