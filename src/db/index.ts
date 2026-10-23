import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

let instance: DB | undefined;

/**
 * Lazily connects so `next build` works without DATABASE_URL. Neon in
 * production; plain node-postgres for a local database (localhost or a socket).
 */
export function getDb(): DB {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const local = /@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url);
    instance = local
      ? (drizzlePg(new pg.Pool({ connectionString: url }), { schema }) as unknown as DB)
      : (drizzleNeon(new NeonPool({ connectionString: url }), { schema }) as unknown as DB);
  }
  return instance;
}

export { schema };
