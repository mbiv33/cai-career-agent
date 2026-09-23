/**
 * Test-only helper: a connection to the local dev Postgres plus throwaway
 * candidate/job fixtures. Mirrors @cai/knowledge's test-db.ts (not itself
 * exported cross-package). We never touch the seeded "Cai" fixture rows;
 * every row created here is deleted in `afterAll` by the caller.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "@cai/db";
import { candidateFacts, candidateProfiles, documents, jobs, users } from "@cai/db";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://cai:cai_dev@localhost:5433/cai_career";

export const db = createDb(DATABASE_URL);

export interface TestCandidate {
  userId: string;
  candidateId: string;
}

export async function createTestCandidate(label: string): Promise<TestCandidate> {
  const email = `documents-test-${label}-${randomUUID()}@example.com`;
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

export type TestJob = typeof jobs.$inferSelect;

export async function createTestJob(overrides: Partial<typeof jobs.$inferInsert> = {}): Promise<TestJob> {
  const [job] = await db
    .insert(jobs)
    .values({
      company: "Test Co",
      title: "Test Role",
      source: "test",
      dedupeKey: randomUUID(),
      ...overrides,
    })
    .returning();
  return job!;
}

/** `documents` has no FK to `jobs` (job id only lives in `meta`), so this is a plain delete. */
export async function cleanupTestJob(jobId: string): Promise<void> {
  await db.delete(jobs).where(eq(jobs.id, jobId));
}

export async function cleanupTestCandidate(candidate: TestCandidate): Promise<void> {
  await db.delete(documents).where(eq(documents.candidateId, candidate.candidateId));
  await db.delete(candidateFacts).where(eq(candidateFacts.candidateId, candidate.candidateId));
  await db.delete(candidateProfiles).where(eq(candidateProfiles.id, candidate.candidateId));
  await db.delete(users).where(eq(users.id, candidate.userId));
}
