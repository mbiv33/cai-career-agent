import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };

export type Db = ReturnType<typeof createDb>;

/**
 * Create a database client. Works against local docker-compose Postgres and
 * Neon (production) — both are plain Postgres connection strings.
 */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) {
    throw new Error("DATABASE_URL is not set (see .env.example)");
  }
  const client = postgres(url, { max: 5, prepare: false });
  return drizzle(client, { schema });
}
