/**
 * Submission flow (spec §9). Gated by the authority model
 * (`application.submit_within_policy`, @cai/core), obstacle-checked one
 * last time immediately before the click, and supports a dry run that stops
 * short of the irreversible action for testing/preview.
 *
 * On success: `application.submitted` audit + APPLYING→SUBMITTED on the job
 * (via `assertTransition`) + applications.status → SUBMITTED.
 * On an obstacle or a withheld authority decision: an escalation +
 * APPLYING→ESCALATED on the job + applications.status → BLOCKED.
 */
import { eq } from "drizzle-orm";
import type { Page } from "playwright";
import type { Db } from "@cai/db";
import { applications, jobs } from "@cai/db";
import {
  assertTransition,
  checkAuthority,
  createEscalation,
  recordAudit,
  type ActionType,
  type AuthorityLevel,
  type JobStatus,
} from "@cai/core";
import { detectObstacle, escalateForObstacle, type PortalSession } from "./session.js";

const SUBMIT_SELECTOR = 'button:has-text("Submit"), input[type="submit"][value*="Submit" i]';

export interface SubmitApplicationOptions {
  db: Db;
  session: PortalSession;
  page: Page;
  candidateId: string;
  applicationId: string;
  jobId: string;
  /** Which agent is submitting (for the audit trail / escalation attribution). */
  raisedBy: string;
  /** Stops before clicking submit — for previewing/testing the flow. Default false. */
  dryRun?: boolean;
  authorityOverrides?: Partial<Record<ActionType, AuthorityLevel>>;
}

export type SubmitOutcome = "submitted" | "dry_run" | "authority_escalated" | "obstacle_escalated";

export interface SubmitApplicationResult {
  outcome: SubmitOutcome;
  escalationId?: string;
}

async function blockApplication(
  db: Db,
  input: { jobId: string; applicationId: string; escalationType: string; reason: string; requiredInput: string; raisedBy: string; candidateId: string },
): Promise<string> {
  const escalation = await createEscalation(db, {
    candidateId: input.candidateId,
    applicationId: input.applicationId,
    jobId: input.jobId,
    type: input.escalationType,
    priority: "CRITICAL",
    reason: input.reason,
    requiredInput: input.requiredInput,
    resumeImmediately: true,
    raisedBy: input.raisedBy,
  });

  const [job] = await db.select().from(jobs).where(eq(jobs.id, input.jobId));
  if (job) {
    assertTransition(job.status as JobStatus, "ESCALATED");
    await db.update(jobs).set({ status: "ESCALATED" }).where(eq(jobs.id, input.jobId));
  }
  await db.update(applications).set({ status: "BLOCKED" }).where(eq(applications.id, input.applicationId));

  return escalation.id;
}

/**
 * Submits an application, gated by authority policy and one last obstacle
 * check. Never clicks submit on a dry run, and never proceeds through a
 * captcha/MFA/login wall — those always escalate and block instead.
 */
export async function submitApplication(options: SubmitApplicationOptions): Promise<SubmitApplicationResult> {
  const { db, session, page, candidateId, applicationId, jobId, raisedBy } = options;

  const decision = checkAuthority("application.submit_within_policy", options.authorityOverrides);
  if (!decision.allowed) {
    const escalationId = await blockApplication(db, {
      jobId,
      applicationId,
      candidateId,
      raisedBy,
      escalationType: "APPLICATION_SUBMIT_AUTHORITY",
      reason: `Submitting this application requires authorization (policy level: ${decision.level}).`,
      requiredInput: "Approve or decline submitting this application.",
    });
    return { outcome: "authority_escalated", escalationId };
  }

  const obstacle = await detectObstacle(page);
  if (obstacle === "captcha" || obstacle === "mfa" || obstacle === "login_required") {
    const escalation = await escalateForObstacle(db, obstacle, {
      candidateId,
      applicationId,
      jobId,
      raisedBy,
      portal: session.portal,
      pageUrl: page.url(),
    });
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    if (job) {
      assertTransition(job.status as JobStatus, "ESCALATED");
      await db.update(jobs).set({ status: "ESCALATED" }).where(eq(jobs.id, jobId));
    }
    await db.update(applications).set({ status: "BLOCKED" }).where(eq(applications.id, applicationId));
    return { outcome: "obstacle_escalated", escalationId: escalation.id };
  }

  if (options.dryRun) {
    return { outcome: "dry_run" };
  }

  await session.clickWithDelay(page.locator(SUBMIT_SELECTOR).first());

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new Error(`Job ${jobId} not found while finalizing submission.`);
  assertTransition(job.status as JobStatus, "SUBMITTED");
  await db.update(jobs).set({ status: "SUBMITTED" }).where(eq(jobs.id, jobId));

  const now = new Date();
  await db.update(applications).set({ status: "SUBMITTED", submittedAt: now }).where(eq(applications.id, applicationId));

  await recordAudit(db, {
    actor: raisedBy,
    eventType: "application.submitted",
    entityType: "application",
    entityId: applicationId,
    action: `Submitted application for job ${jobId} via portal "${session.portal}"`,
    policyReference: "application.submit_within_policy",
  });

  return { outcome: "submitted" };
}
