/**
 * Append-only audit writer (spec §5.8, FR-9). This module is the ONLY sanctioned
 * path for writing audit_events; there is deliberately no update or delete.
 */
import type { Db } from "@cai/db";
import { auditEvents } from "@cai/db";

export interface AuditInput {
  actor: string; // agent name | "candidate" | "system"
  eventType: string; // e.g. "job.discovered", "application.submitted"
  entityType: string;
  entityId?: string;
  action: string; // human-readable, shown verbatim in the Activity feed
  reason?: string;
  evidence?: unknown;
  policyReference?: string;
}

export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    actor: input.actor,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    reason: input.reason,
    evidence: input.evidence,
    policyReference: input.policyReference,
  });
}
