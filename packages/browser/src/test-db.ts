/**
 * Shared test helpers: a connection to the local dev Postgres, an isolated
 * throwaway candidate for tests that shouldn't touch real data (vault
 * tests), and — for the answer-resolution-dependent tests (form-fill) — a
 * way to run against the real seeded "Cai" candidate's facts while still
 * only ever creating/deleting our own throwaway job + application rows.
 * We never write to or delete the seeded fixture rows themselves.
 */
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "@cai/db";
import {
  applicationAnswers,
  applications,
  auditEvents,
  candidateFacts,
  candidateProfiles,
  escalations,
  jobs,
  portalCredentials,
  users,
} from "@cai/db";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://cai:cai_dev@localhost:5433/cai_career";

export const db = createDb(DATABASE_URL);

// ---------------------------------------------------------------------------
// Fully isolated throwaway candidate (vault tests — no shared state at all)
// ---------------------------------------------------------------------------

export interface TestCandidate {
  userId: string;
  candidateId: string;
}

export async function createTestCandidate(label: string): Promise<TestCandidate> {
  const email = `browser-test-${label}-${randomUUID()}@example.com`;
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

export async function cleanupTestCandidate(candidate: TestCandidate): Promise<void> {
  await db.delete(applicationAnswers).where(eq(applicationAnswers.candidateId, candidate.candidateId));
  await db.delete(escalations).where(eq(escalations.candidateId, candidate.candidateId));
  await db.delete(portalCredentials).where(eq(portalCredentials.candidateId, candidate.candidateId));
  await db.delete(candidateFacts).where(eq(candidateFacts.candidateId, candidate.candidateId));
  await db.delete(candidateProfiles).where(eq(candidateProfiles.id, candidate.candidateId));
  await db.delete(users).where(eq(users.id, candidate.userId));
}

// ---------------------------------------------------------------------------
// Real seeded "Cai" candidate + our own throwaway job/application rows
// ---------------------------------------------------------------------------

/** Looks up the seeded "Cai" candidate's id. Never mutated by these tests. */
export async function getSeededCandidateId(): Promise<string> {
  const [row] = await db.select().from(candidateProfiles).where(eq(candidateProfiles.displayName, "Cai"));
  if (!row) {
    throw new Error('Seeded candidate "Cai" not found in the local DB — run `pnpm db:seed` first.');
  }
  return row.id;
}

export interface JobApplicationFixture {
  jobId: string;
  applicationId: string;
}

/** Creates a throwaway job + application against the given (real) candidate. Caller must clean up. */
export async function createJobApplicationFixture(
  candidateId: string,
  label: string,
  jobStatus: "APPLYING" = "APPLYING",
): Promise<JobApplicationFixture> {
  const dedupeKey = createHash("sha256").update(`browser-test|${label}|${randomUUID()}`).digest("hex");
  const [job] = await db
    .insert(jobs)
    .values({
      company: "Fixture Test Co",
      title: `Browser Test Role (${label})`,
      location: "Remote",
      source: "fixtures",
      dedupeKey,
      status: jobStatus,
    })
    .returning();

  const [application] = await db
    .insert(applications)
    .values({ jobId: job!.id, candidateId, status: "IN_PROGRESS", startedAt: new Date() })
    .returning();

  return { jobId: job!.id, applicationId: application!.id };
}

/** Deletes only the rows this fixture created — never touches the seeded candidate/facts. */
export async function cleanupJobApplicationFixture(fixture: JobApplicationFixture): Promise<void> {
  await db.delete(applicationAnswers).where(eq(applicationAnswers.applicationId, fixture.applicationId));
  await db.delete(escalations).where(eq(escalations.applicationId, fixture.applicationId));
  await db.delete(applications).where(eq(applications.id, fixture.applicationId));
  await db.delete(jobs).where(eq(jobs.id, fixture.jobId));
}

/** Inserts a throwaway verified answer scoped to `applicationId` (deleted by `cleanupJobApplicationFixture`). */
export async function seedVerifiedAnswer(input: {
  candidateId: string;
  applicationId: string;
  questionPattern: string;
  answer: unknown;
}): Promise<void> {
  await db.insert(applicationAnswers).values({
    candidateId: input.candidateId,
    applicationId: input.applicationId,
    questionPattern: input.questionPattern,
    answer: input.answer,
    source: "candidate_confirmed",
    verified: true,
    authorityLevel: "AUTO",
  });
}

/** Audit rows are append-only per CLAUDE.md — never deleted; this just counts how many a test produced. */
export async function countAuditEvents(entityType: string, entityId: string): Promise<number> {
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.entityId, entityId));
  return rows.filter((r) => r.entityType === entityType).length;
}
