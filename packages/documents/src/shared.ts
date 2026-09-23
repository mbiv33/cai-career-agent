/**
 * Shared plumbing between resume.ts and generate_cover_letter — loading the
 * target job, and persisting a guard-verified generation (file + `documents`
 * row + audit + model-call log), or auditing a rejection. Kept here so both
 * generators follow the exact same store/audit contract.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@cai/db";
import { documents, jobs } from "@cai/db";
import { checkAuthority, recordAudit, type ActionType, type AuthorityLevel } from "@cai/core";
import { logModelCall, type AgentTask, type ModelResponse } from "@cai/agents";
import { saveDocument } from "./storage.js";
import type { FabricationGuardError } from "./errors.js";
import type { GuardResult } from "./fabrication-guard.js";

export type DocumentRow = typeof documents.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;

export async function loadJob(db: Db, jobId: string): Promise<JobRow> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error(`Job ${jobId} not found`);
  return job;
}

export type DocumentKind = "resume" | "cover_letter";

export interface PersistGuardedDocumentInput {
  db: Db;
  candidateId: string;
  kind: DocumentKind;
  title: string;
  parentDocumentId?: string;
  jobId: string;
  guard: GuardResult;
  response: ModelResponse;
  task: AgentTask;
  actor: string;
  runId?: string;
  policyReference: ActionType;
  authorityOverrides?: Partial<Record<ActionType, AuthorityLevel>>;
}

/** Writes the file, inserts the `documents` row, logs the model call, and audits `document.created`. */
export async function persistGuardedDocument(input: PersistGuardedDocumentInput): Promise<DocumentRow> {
  const docId = randomUUID();
  const storagePath = await saveDocument({
    candidateId: input.candidateId,
    docId,
    content: input.guard.strippedText,
  });

  const authority = checkAuthority(input.policyReference, input.authorityOverrides);

  const [row] = await input.db
    .insert(documents)
    .values({
      id: docId,
      candidateId: input.candidateId,
      kind: input.kind,
      title: input.title,
      parentDocumentId: input.parentDocumentId,
      storagePath,
      contentText: input.guard.strippedText,
      meta: {
        jobId: input.jobId,
        model: input.response.usage.model,
        citations: input.guard.citedFactIds,
        citedSource: input.response.text,
      },
    })
    .returning();

  await logModelCall(input.db, {
    agent: "application",
    task: input.task,
    runId: input.runId,
    usage: input.response.usage,
    summary: `Generated ${input.kind} — ${input.title}`,
  });

  await recordAudit(input.db, {
    actor: input.actor,
    eventType: "document.created",
    entityType: "document",
    entityId: row!.id,
    action: `Generated ${input.kind === "resume" ? "résumé" : "cover letter"}: ${input.title}`,
    evidence: {
      jobId: input.jobId,
      citations: input.guard.citedFactIds,
      model: input.response.usage.model,
      authority,
    },
    policyReference: input.policyReference,
  });

  return row!;
}

export interface RecordFabricationRejectionInput {
  db: Db;
  actor: string;
  jobId: string;
  kind: DocumentKind;
  task: AgentTask;
  runId?: string;
  response: ModelResponse;
  error: FabricationGuardError;
  policyReference: ActionType;
}

/** Audits a guard rejection. No file is written and no `documents` row is created. */
export async function recordFabricationRejection(input: RecordFabricationRejectionInput): Promise<void> {
  await logModelCall(input.db, {
    agent: "application",
    task: input.task,
    runId: input.runId,
    usage: input.response.usage,
    summary: `${input.kind === "resume" ? "Résumé" : "Cover letter"} generation rejected by fabrication guard`,
  });

  await recordAudit(input.db, {
    actor: input.actor,
    eventType: "document.generation_rejected",
    entityType: "job",
    entityId: input.jobId,
    action: `Rejected ${input.kind === "resume" ? "résumé" : "cover letter"} generation: ${input.error.message}`,
    reason: input.error.message,
    evidence: { context: input.error.context, rawResponse: input.response.text },
    policyReference: input.policyReference,
  });
}
