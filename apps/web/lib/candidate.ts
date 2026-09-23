import { asc } from "drizzle-orm";
import type { Db } from "@cai/db";
import { candidateProfiles } from "@cai/db";

/**
 * Stage 1 is single-candidate (Cai). Pulls the first profile row so pages
 * don't hardcode an id. Callers already run inside `withDb`, so this throws
 * straight through to that shared error handling on connection failure.
 */
export async function getPrimaryCandidate(db: Db) {
  const [row] = await db
    .select()
    .from(candidateProfiles)
    .orderBy(asc(candidateProfiles.createdAt))
    .limit(1);
  return row ?? null;
}
