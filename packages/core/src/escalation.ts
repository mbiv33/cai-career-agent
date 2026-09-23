/**
 * HITL escalation creator (spec §12). Escalations carry structured context —
 * what happened, why Cai is needed, the recommendation, the required input,
 * deadline, and consequence — never just "open a chat".
 */
import type { Db } from "@cai/db";
import { escalations } from "@cai/db";
import { recordAudit } from "./audit.js";

export interface EscalationInput {
  candidateId: string;
  applicationId?: string;
  jobId?: string;
  type: string;
  priority?: "CRITICAL" | "ACTION" | "UPDATE" | "DIGEST";
  reason: string;
  recommendedAction?: string;
  requiredInput: string;
  deadline?: Date;
  consequenceOfNoAction?: string;
  /** Resolving should immediately resume the blocked workflow (time-sensitive). */
  resumeImmediately?: boolean;
  /** Which agent raised it (for the audit trail). */
  raisedBy: string;
}

export async function createEscalation(db: Db, input: EscalationInput) {
  const [row] = await db
    .insert(escalations)
    .values({
      candidateId: input.candidateId,
      applicationId: input.applicationId,
      jobId: input.jobId,
      type: input.type,
      priority: input.priority ?? "ACTION",
      reason: input.reason,
      recommendedAction: input.recommendedAction,
      requiredInput: input.requiredInput,
      deadline: input.deadline,
      consequenceOfNoAction: input.consequenceOfNoAction,
      resumeImmediately: input.resumeImmediately ?? false,
    })
    .returning();

  await recordAudit(db, {
    actor: input.raisedBy,
    eventType: "escalation.created",
    entityType: "escalation",
    entityId: row!.id,
    action: `Escalated: ${input.reason}`,
    reason: input.requiredInput,
  });

  return row!;
}
