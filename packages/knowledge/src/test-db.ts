/**
 * Shared test helper: a connection to the local dev Postgres plus a fully
 * isolated candidate for DB-touching tests. We never write to the seeded
 * fixture rows (the "Cai" candidate from `pnpm db:seed`) — tests that need
 * to assert against that data only read it. Every isolated candidate this
 * helper creates is torn down in `afterAll`, so no `pnpm db:seed` restore is
 * needed after running the suite.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "@cai/db";
import {
  applicationAnswers,
  candidateFacts,
  candidateProfiles,
  preferences,
  users,
} from "@cai/db";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://cai:cai_dev@localhost:5433/cai_career";

export const db = createDb(DATABASE_URL);

export interface TestCandidate {
  userId: string;
  candidateId: string;
}

/** Creates a throwaway user + candidate profile, unrelated to the seed fixtures. */
export async function createTestCandidate(label: string): Promise<TestCandidate> {
  const email = `knowledge-test-${label}-${randomUUID()}@example.com`;
  const [user] = await db
    .insert(users)
    .values({ email, name: `Test Candidate (${label})`, role: "candidate" })
    .returning();

  const [candidate] = await db
    .insert(candidateProfiles)
    .values({ userId: user!.id, displayName: `Test Candidate (${label})` })
    .returning();

  return { userId: user!.id, candidateId: candidate!.id };
}

/**
 * Deletes the profile rows this helper created. `audit_events` is
 * append-only per CLAUDE.md (no update/delete code, ever) — test-generated
 * audit rows are intentionally left in place; they're inert and clearly
 * tagged with the throwaway candidate/user ids this helper generates.
 */
export async function cleanupTestCandidate(candidate: TestCandidate): Promise<void> {
  await db.delete(applicationAnswers).where(eq(applicationAnswers.candidateId, candidate.candidateId));
  await db.delete(candidateFacts).where(eq(candidateFacts.candidateId, candidate.candidateId));
  await db.delete(preferences).where(eq(preferences.candidateId, candidate.candidateId));
  await db.delete(candidateProfiles).where(eq(candidateProfiles.id, candidate.candidateId));
  await db.delete(users).where(eq(users.id, candidate.userId));
}
