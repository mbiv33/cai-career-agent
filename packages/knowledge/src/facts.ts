/**
 * Typed CRUD over `candidate_facts` (PRD FR-1, spec §5.1). One row per
 * (candidateId, category, key); provenance travels with every value.
 *
 * Hard rule (CLAUDE.md / PRD §7): an observation must never silently become
 * authoritative. Concretely, an `agent_inferred` write is never allowed to
 * overwrite a `candidate_confirmed` fact — that always throws
 * `ProvenanceConflictError` so the caller escalates instead.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@cai/db";
import { candidateFacts, provenance as provenanceEnum } from "@cai/db";
import { recordAudit } from "@cai/core";
import { ProvenanceConflictError } from "./errors.js";

export type Provenance = (typeof provenanceEnum.enumValues)[number];
export type CandidateFactRow = typeof candidateFacts.$inferSelect;

export interface UpsertFactInput {
  candidateId: string;
  category: string;
  key: string;
  value: unknown;
  sourceType: Provenance;
  sourceReference?: string;
  /** 0–1 confidence; stored with 2 decimal places to match the schema's numeric(3,2). */
  confidence?: number;
  /** "candidate" or the agent name performing the write, for the audit trail. */
  actor: string;
}

export interface ConfirmFactInput {
  candidateId: string;
  category: string;
  key: string;
  /** Optionally correct the value at confirmation time (candidate edited it). */
  value?: unknown;
  actor: string;
}

function factWhere(candidateId: string, category: string, key: string) {
  return and(
    eq(candidateFacts.candidateId, candidateId),
    eq(candidateFacts.category, category),
    eq(candidateFacts.key, key),
  );
}

/**
 * Pure guard, exported so it can be unit tested without a database. Throws
 * iff an existing candidate-confirmed value would be overwritten by an
 * agent-inferred one.
 */
export function assertNoProvenanceDowngrade(
  existing: Pick<CandidateFactRow, "sourceType"> | undefined,
  incoming: { sourceType: Provenance },
  context: Record<string, unknown>,
): void {
  if (existing?.sourceType === "candidate_confirmed" && incoming.sourceType === "agent_inferred") {
    throw new ProvenanceConflictError(
      "Refusing to overwrite a candidate-confirmed fact with an agent-inferred value. Escalate instead of retrying.",
      context,
    );
  }
}

export async function getFacts(
  db: Db,
  candidateId: string,
  category?: string,
): Promise<CandidateFactRow[]> {
  const where = category
    ? and(eq(candidateFacts.candidateId, candidateId), eq(candidateFacts.category, category))
    : eq(candidateFacts.candidateId, candidateId);
  return db.select().from(candidateFacts).where(where);
}

export async function getFact(
  db: Db,
  candidateId: string,
  category: string,
  key: string,
): Promise<CandidateFactRow | undefined> {
  const rows = await db
    .select()
    .from(candidateFacts)
    .where(factWhere(candidateId, category, key))
    .limit(1);
  return rows[0];
}

export async function upsertFact(db: Db, input: UpsertFactInput): Promise<CandidateFactRow> {
  const existing = await getFact(db, input.candidateId, input.category, input.key);

  assertNoProvenanceDowngrade(existing, input, {
    candidateId: input.candidateId,
    category: input.category,
    key: input.key,
    existingValue: existing?.value,
    attemptedValue: input.value,
  });

  const confidence = input.confidence !== undefined ? input.confidence.toFixed(2) : undefined;

  if (existing) {
    const [updated] = await db
      .update(candidateFacts)
      .set({
        value: input.value,
        sourceType: input.sourceType,
        sourceReference: input.sourceReference,
        ...(confidence !== undefined ? { confidence } : {}),
        updatedAt: new Date(),
      })
      .where(eq(candidateFacts.id, existing.id))
      .returning();

    await recordAudit(db, {
      actor: input.actor,
      eventType: "fact.updated",
      entityType: "candidate_fact",
      entityId: updated!.id,
      action: `Updated ${input.category}.${input.key}`,
      evidence: { previous: existing.value, next: input.value, sourceType: input.sourceType },
    });

    return updated!;
  }

  const [created] = await db
    .insert(candidateFacts)
    .values({
      candidateId: input.candidateId,
      category: input.category,
      key: input.key,
      value: input.value,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference,
      ...(confidence !== undefined ? { confidence } : {}),
    })
    .returning();

  await recordAudit(db, {
    actor: input.actor,
    eventType: "fact.created",
    entityType: "candidate_fact",
    entityId: created!.id,
    action: `Recorded ${input.category}.${input.key}`,
    evidence: { value: input.value, sourceType: input.sourceType },
  });

  return created!;
}

/** Marks a fact candidate-confirmed (e.g. the candidate reviewed an agent-inferred value). */
export async function confirmFact(db: Db, input: ConfirmFactInput): Promise<CandidateFactRow> {
  const existing = await getFact(db, input.candidateId, input.category, input.key);
  if (!existing) {
    throw new Error(
      `Cannot confirm unknown fact ${input.category}.${input.key} for candidate ${input.candidateId}`,
    );
  }

  const [updated] = await db
    .update(candidateFacts)
    .set({
      value: input.value !== undefined ? input.value : existing.value,
      sourceType: "candidate_confirmed",
      verifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(candidateFacts.id, existing.id))
    .returning();

  await recordAudit(db, {
    actor: input.actor,
    eventType: "fact.confirmed",
    entityType: "candidate_fact",
    entityId: updated!.id,
    action: `Confirmed ${input.category}.${input.key}`,
    evidence: { value: updated!.value },
  });

  return updated!;
}
