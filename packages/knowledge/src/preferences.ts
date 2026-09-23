/**
 * Typed CRUD over `preferences` (PRD §5.2, §7). Same shape as facts.ts: one
 * active row per (candidateId, type), provenance travels with the value.
 *
 * Two independent hard rules apply here:
 *  1. Same as facts: an `agent_inferred` write never overwrites a
 *     `candidate_confirmed` preference (ProvenanceConflictError).
 *  2. Spec-specific: an `agent_inferred` preference may NEVER be created or
 *     updated with strength `hard_constraint` — only a candidate can set a
 *     hard constraint. An inference that looks like a hard constraint must
 *     be proposed at a softer strength and escalated for confirmation.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@cai/db";
import { preferences } from "@cai/db";
import { recordAudit } from "@cai/core";
import { ProvenanceConflictError } from "./errors.js";
import type { Provenance } from "./facts.js";

export type PreferenceRow = typeof preferences.$inferSelect;
export type PreferenceStrength = "hard_constraint" | "strong_preference" | "preference" | "open";

export interface UpsertPreferenceInput {
  candidateId: string;
  type: string;
  value: unknown;
  strength: PreferenceStrength;
  source: Provenance;
  confidence?: number;
  actor: string;
}

export interface ConfirmPreferenceInput {
  candidateId: string;
  type: string;
  value?: unknown;
  /** Confirmation may also be the moment a preference becomes a hard constraint. */
  strength?: PreferenceStrength;
  actor: string;
}

export interface DeactivatePreferenceInput {
  candidateId: string;
  type: string;
  actor: string;
  reason?: string;
}

function prefWhere(candidateId: string, type: string) {
  return and(eq(preferences.candidateId, candidateId), eq(preferences.type, type));
}

/** Pure guard: no agent-inferred hard constraints, ever. Unit-testable without a DB. */
export function assertHardConstraintRequiresConfirmation(
  input: { strength: PreferenceStrength; source: Provenance },
  context: Record<string, unknown>,
): void {
  if (input.strength === "hard_constraint" && input.source === "agent_inferred") {
    throw new ProvenanceConflictError(
      "Refusing to set a hard_constraint preference from an agent-inferred source. Only candidate_confirmed preferences may be hard constraints — propose a softer strength and escalate instead.",
      context,
    );
  }
}

/** Pure guard: same provenance-downgrade rule as facts.ts. Unit-testable without a DB. */
export function assertNoPreferenceProvenanceDowngrade(
  existing: Pick<PreferenceRow, "source"> | undefined,
  incoming: { source: Provenance },
  context: Record<string, unknown>,
): void {
  if (existing?.source === "candidate_confirmed" && incoming.source === "agent_inferred") {
    throw new ProvenanceConflictError(
      "Refusing to overwrite a candidate-confirmed preference with an agent-inferred value. Escalate instead of retrying.",
      context,
    );
  }
}

export async function getPreferences(
  db: Db,
  candidateId: string,
  type?: string,
): Promise<PreferenceRow[]> {
  const where = type
    ? and(eq(preferences.candidateId, candidateId), eq(preferences.type, type))
    : eq(preferences.candidateId, candidateId);
  return db.select().from(preferences).where(where);
}

export async function getActivePreference(
  db: Db,
  candidateId: string,
  type: string,
): Promise<PreferenceRow | undefined> {
  const rows = await db
    .select()
    .from(preferences)
    .where(and(prefWhere(candidateId, type), eq(preferences.active, true)))
    .limit(1);
  return rows[0];
}

export async function upsertPreference(
  db: Db,
  input: UpsertPreferenceInput,
): Promise<PreferenceRow> {
  const existing = await getActivePreference(db, input.candidateId, input.type);

  const context = {
    candidateId: input.candidateId,
    type: input.type,
    existingValue: existing?.value,
    attemptedValue: input.value,
  };

  assertHardConstraintRequiresConfirmation(input, context);
  assertNoPreferenceProvenanceDowngrade(existing, input, context);

  const confidence = input.confidence !== undefined ? input.confidence.toFixed(2) : undefined;

  if (existing) {
    const [updated] = await db
      .update(preferences)
      .set({
        value: input.value,
        strength: input.strength,
        source: input.source,
        ...(confidence !== undefined ? { confidence } : {}),
        updatedAt: new Date(),
      })
      .where(eq(preferences.id, existing.id))
      .returning();

    await recordAudit(db, {
      actor: input.actor,
      eventType: "preference.updated",
      entityType: "preference",
      entityId: updated!.id,
      action: `Updated preference ${input.type}`,
      evidence: { previous: existing.value, next: input.value, strength: input.strength, source: input.source },
    });

    return updated!;
  }

  const [created] = await db
    .insert(preferences)
    .values({
      candidateId: input.candidateId,
      type: input.type,
      value: input.value,
      strength: input.strength,
      source: input.source,
      ...(confidence !== undefined ? { confidence } : {}),
    })
    .returning();

  await recordAudit(db, {
    actor: input.actor,
    eventType: "preference.created",
    entityType: "preference",
    entityId: created!.id,
    action: `Recorded preference ${input.type}`,
    evidence: { value: input.value, strength: input.strength, source: input.source },
  });

  return created!;
}

export async function confirmPreference(
  db: Db,
  input: ConfirmPreferenceInput,
): Promise<PreferenceRow> {
  const existing = await getActivePreference(db, input.candidateId, input.type);
  if (!existing) {
    throw new Error(
      `Cannot confirm unknown preference ${input.type} for candidate ${input.candidateId}`,
    );
  }

  const [updated] = await db
    .update(preferences)
    .set({
      value: input.value !== undefined ? input.value : existing.value,
      strength: input.strength ?? existing.strength,
      source: "candidate_confirmed",
      updatedAt: new Date(),
    })
    .where(eq(preferences.id, existing.id))
    .returning();

  await recordAudit(db, {
    actor: input.actor,
    eventType: "preference.confirmed",
    entityType: "preference",
    entityId: updated!.id,
    action: `Confirmed preference ${input.type}`,
    evidence: { value: updated!.value, strength: updated!.strength },
  });

  return updated!;
}

export async function deactivatePreference(
  db: Db,
  input: DeactivatePreferenceInput,
): Promise<PreferenceRow | undefined> {
  const existing = await getActivePreference(db, input.candidateId, input.type);
  if (!existing) {
    return undefined;
  }

  const [updated] = await db
    .update(preferences)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(preferences.id, existing.id))
    .returning();

  await recordAudit(db, {
    actor: input.actor,
    eventType: "preference.deactivated",
    entityType: "preference",
    entityId: updated!.id,
    action: `Deactivated preference ${input.type}`,
    reason: input.reason,
  });

  return updated!;
}
