/**
 * Shared, lazily-initialized DB singleton for server components/actions.
 *
 * `createDb()` itself only throws if DATABASE_URL is unset — the underlying
 * postgres.js client connects lazily on first query — so every read in this
 * app must go through `withDb`, which catches both "never configured" and
 * "configured but unreachable" failures and returns a typed result instead
 * of throwing. This keeps `next build` from ever requiring a live database,
 * and keeps every page degrading to a friendly message instead of a 500.
 */
import { createDb, type Db } from "@cai/db";

let dbInstance: Db | undefined;

function getDb(): Db {
  if (!dbInstance) {
    dbInstance = createDb();
  }
  return dbInstance;
}

export type DbResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<DbResult<T>> {
  try {
    const db = getDb();
    const data = await fn(db);
    return { ok: true, data };
  } catch (err) {
    // Reset the cached instance so a later request can retry a fresh connection.
    dbInstance = undefined;
    const message = err instanceof Error ? err.message : "Unknown database error";
    console.error("[db] query failed:", message);
    return { ok: false, error: message };
  }
}
