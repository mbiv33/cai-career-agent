/**
 * Qualification stage (PRD FR-4, spec §6 Qualification Agent).
 *
 * Hard constraints (compensation floor, work-environment hard constraints)
 * are applied deterministically in code — a failure rejects the job without
 * any model call. Jobs that pass go to the model (`qualify_job`, sonnet
 * tier) for career-fit / preference-fit judgment. Every decision is
 * persisted with its reasoning and audited.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@cai/db";
import { jobEvaluations, jobs, preferences } from "@cai/db";
import {
  assertTransition,
  checkAuthority,
  recordAudit,
  type ActionType,
  type AuthorityLevel,
  type JobStatus,
  type StageResult,
  type TokenUsage,
} from "@cai/core";
import type { ModelRunner } from "./runner.js";
import { logModelCall } from "./token-log.js";
import { asRecord, bump, num, str, toStringList } from "./json-utils.js";

// ---------------------------------------------------------------------------
// Hard constraints — deterministic, no model call
// ---------------------------------------------------------------------------

export interface HardConstraintCheck {
  key: string;
  result: "pass" | "fail" | "not_applicable";
  detail: string;
}

export interface HardConstraintEvaluation {
  passed: boolean;
  checks: HardConstraintCheck[];
}

/** Subset of the `jobs` row this evaluation needs. */
export interface JobLike {
  compensationMin?: number | null;
  compensationMax?: number | null;
  workEnvironment?: string | null;
}

/** Subset of the `preferences` row this evaluation needs. */
export interface PreferenceLike {
  type: string;
  value: unknown;
  strength: string;
  active: boolean;
}

/**
 * Applies only the preferences whose `strength` is `hard_constraint`.
 * `compensation` preference value shape: `{ minimum?: number }`.
 * `work_environment` preference value shape: `{ required?: string | string[], excluded?: string | string[] }`.
 * Everything else (soft preferences, career fit) is the model's job.
 */
export function evaluateHardConstraints(
  job: JobLike,
  candidatePreferences: PreferenceLike[],
): HardConstraintEvaluation {
  const checks: HardConstraintCheck[] = [];
  const hardPrefs = candidatePreferences.filter((p) => p.active && p.strength === "hard_constraint");

  const compPref = hardPrefs.find((p) => p.type === "compensation");
  if (compPref) {
    const value = asRecord(compPref.value);
    const minimum = num(value?.minimum);
    if (minimum === undefined) {
      checks.push({
        key: "compensation_floor",
        result: "not_applicable",
        detail: "Hard-constraint compensation preference has no minimum set.",
      });
    } else {
      const best = job.compensationMax ?? job.compensationMin ?? undefined;
      if (best === undefined || best === null) {
        checks.push({
          key: "compensation_floor",
          result: "not_applicable",
          detail: "Job posting has no compensation data.",
        });
      } else if (best < minimum) {
        checks.push({
          key: "compensation_floor",
          result: "fail",
          detail: `Best-case pay $${best.toLocaleString()} is below the $${minimum.toLocaleString()} floor.`,
        });
      } else {
        checks.push({
          key: "compensation_floor",
          result: "pass",
          detail: `Best-case pay $${best.toLocaleString()} meets the $${minimum.toLocaleString()} floor.`,
        });
      }
    }
  }

  const envPref = hardPrefs.find((p) => p.type === "work_environment");
  if (envPref) {
    const value = asRecord(envPref.value);
    const required = toStringList(value?.required);
    const excluded = toStringList(value?.excluded);
    const jobEnv = job.workEnvironment ?? undefined;
    if (!jobEnv) {
      checks.push({
        key: "work_environment",
        result: "not_applicable",
        detail: "Job posting has no work-environment data.",
      });
    } else if (excluded.includes(jobEnv)) {
      checks.push({
        key: "work_environment",
        result: "fail",
        detail: `Work environment "${jobEnv}" is on the excluded list (${excluded.join(", ")}).`,
      });
    } else if (required.length > 0 && !required.includes(jobEnv)) {
      checks.push({
        key: "work_environment",
        result: "fail",
        detail: `Work environment "${jobEnv}" is not one of the required environments (${required.join(", ")}).`,
      });
    } else {
      checks.push({
        key: "work_environment",
        result: "pass",
        detail: `Work environment "${jobEnv}" satisfies the hard constraint.`,
      });
    }
  }

  const passed = checks.every((c) => c.result !== "fail");
  return { passed, checks };
}

// ---------------------------------------------------------------------------
// Model qualification
// ---------------------------------------------------------------------------

export interface QualificationVerdict {
  decision: "qualified" | "rejected";
  reasoning: string;
  careerFit: unknown;
  preferenceFit: unknown;
}

const QUALIFY_SYSTEM_PROMPT = `You are the qualification agent for a job-search assistant.
Given a candidate's confirmed preferences and a normalized job posting that has already
passed hard-constraint screening, decide whether to recommend it. Return ONLY a JSON object
(no prose, no markdown fences) with exactly these keys:
decision ("qualified" or "rejected"), reasoning (string, 1-3 sentences),
careerFit (string describing how this advances or conflicts with the candidate's career direction),
preferenceFit (string describing how this matches or conflicts with soft preferences).
Never invent facts about the candidate or the posting that were not provided to you.`;

/** Strict validation — bad/absent JSON must never silently become a decision. */
export function parseQualificationVerdict(text: string): QualificationVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record) return null;
  const decision = record.decision;
  if (decision !== "qualified" && decision !== "rejected") return null;
  const reasoning = str(record.reasoning);
  if (!reasoning) return null;
  return {
    decision,
    reasoning,
    careerFit: record.careerFit ?? null,
    preferenceFit: record.preferenceFit ?? null,
  };
}

export type QualificationOutcome =
  | { kind: "hard_constraint_rejected"; reasoning: string }
  | { kind: "invalid_model_output"; rawResponse: string; usage: TokenUsage }
  | { kind: "model_decided"; verdict: QualificationVerdict; usage: TokenUsage };

export interface QualificationDecision {
  hardConstraints: HardConstraintEvaluation;
  outcome: QualificationOutcome;
}

/**
 * Pure(ish) decision logic with no DB access, so it's directly unit
 * testable: hard-constraint failures never touch `runner`, and every path
 * returns a `reasoning`-bearing result.
 */
export async function evaluateJob(
  runner: ModelRunner,
  job: JobLike & { company?: string; title?: string; location?: string | null },
  candidatePreferences: PreferenceLike[],
): Promise<QualificationDecision> {
  const hardConstraints = evaluateHardConstraints(job, candidatePreferences);

  if (!hardConstraints.passed) {
    const reasoning = hardConstraints.checks
      .filter((c) => c.result === "fail")
      .map((c) => c.detail)
      .join(" ");
    return { hardConstraints, outcome: { kind: "hard_constraint_rejected", reasoning } };
  }

  const response = await runner.run({
    task: "qualify_job",
    system: QUALIFY_SYSTEM_PROMPT,
    prompt: JSON.stringify({
      candidatePreferences: candidatePreferences.map((p) => ({
        type: p.type,
        value: p.value,
        strength: p.strength,
      })),
      job,
    }),
  });

  const verdict = parseQualificationVerdict(response.text);
  if (!verdict) {
    return { hardConstraints, outcome: { kind: "invalid_model_output", rawResponse: response.text, usage: response.usage } };
  }
  return { hardConstraints, outcome: { kind: "model_decided", verdict, usage: response.usage } };
}

// ---------------------------------------------------------------------------
// Stage runner
// ---------------------------------------------------------------------------

export interface QualificationStageDeps {
  db: Db;
  runner: ModelRunner;
  candidateId: string;
  runId: string;
  dryRun: boolean;
  authorityOverrides?: Partial<Record<ActionType, AuthorityLevel>>;
}

export async function runQualificationStage(deps: QualificationStageDeps): Promise<StageResult> {
  const { db, runner, candidateId, runId, dryRun, authorityOverrides } = deps;

  const counts: Record<string, number> = {
    evaluated: 0,
    qualified: 0,
    rejected: 0,
    hardConstraintRejected: 0,
    invalidModelOutput: 0,
  };

  const activePreferences = await db
    .select()
    .from(preferences)
    .where(and(eq(preferences.candidateId, candidateId), eq(preferences.active, true)));

  // Jobs aren't candidate-scoped in the schema (single-candidate system);
  // qualification evaluates every job the discovery stage normalized.
  const candidateJobs = await db.select().from(jobs).where(eq(jobs.status, "NORMALIZED"));

  for (const job of candidateJobs) {
    bump(counts, "evaluated");

    if (!dryRun) {
      assertTransition("NORMALIZED", "QUALIFYING");
      await db.update(jobs).set({ status: "QUALIFYING" }).where(eq(jobs.id, job.id));
    }

    const decision = await evaluateJob(runner, job, activePreferences);

    if (decision.outcome.kind === "hard_constraint_rejected") {
      bump(counts, "hardConstraintRejected");
      bump(counts, "rejected");
      if (!dryRun) {
        assertTransition("QUALIFYING", "REJECTED");
        await db.update(jobs).set({ status: "REJECTED" }).where(eq(jobs.id, job.id));

        await db.insert(jobEvaluations).values({
          jobId: job.id,
          candidateId,
          hardConstraintResult: decision.hardConstraints,
          qualificationResult: { evaluated: false, reason: "hard_constraint_failure" },
          careerFitResult: { evaluated: false, reason: "hard_constraint_failure" },
          preferenceFitResult: { evaluated: false, reason: "hard_constraint_failure" },
          decision: "rejected",
          reasoning: decision.outcome.reasoning,
          rulesApplied: decision.hardConstraints.checks.map((c) => c.key),
          modelVersion: "deterministic:hard_constraints",
        });

        const authority = checkAuthority("job.reject_mismatch", authorityOverrides);
        await recordAudit(db, {
          actor: "qualification",
          eventType: "job.rejected",
          entityType: "job",
          entityId: job.id,
          action: `Rejected ${job.company} — ${job.title} (hard constraint)`,
          reason: decision.outcome.reasoning,
          evidence: { hardConstraints: decision.hardConstraints, authority },
          policyReference: "job.reject_mismatch",
        });
      }
      continue; // no model call for a hard-constraint failure
    }

    if (decision.outcome.kind === "invalid_model_output") {
      bump(counts, "invalidModelOutput");
      if (!dryRun) {
        await logModelCall(db, {
          agent: "qualification",
          task: "qualify_job",
          runId,
          usage: decision.outcome.usage,
          summary: `Qualification model output invalid for ${job.company} — ${job.title}`,
        });
        await recordAudit(db, {
          actor: "qualification",
          eventType: "job.qualification_failed",
          entityType: "job",
          entityId: job.id,
          action: `Qualification model returned invalid output for ${job.company} — ${job.title}; left in QUALIFYING`,
          reason: "Model output was not valid {decision, reasoning} JSON.",
          evidence: { rawResponse: decision.outcome.rawResponse },
        });
      }
      continue; // stays QUALIFYING — no jobEvaluations row, no further transition
    }

    // model_decided
    const { verdict, usage } = decision.outcome;
    if (verdict.decision === "qualified") bump(counts, "qualified");
    else bump(counts, "rejected");

    if (!dryRun) {
      await logModelCall(db, {
        agent: "qualification",
        task: "qualify_job",
        runId,
        usage,
        summary: `Qualified ${job.company} — ${job.title}: ${verdict.decision}`,
      });

      const nextStatus: JobStatus = verdict.decision === "qualified" ? "QUALIFIED" : "REJECTED";
      assertTransition("QUALIFYING", nextStatus);
      await db.update(jobs).set({ status: nextStatus }).where(eq(jobs.id, job.id));

      await db.insert(jobEvaluations).values({
        jobId: job.id,
        candidateId,
        hardConstraintResult: decision.hardConstraints,
        qualificationResult: { evaluatedBy: "model", decision: verdict.decision },
        careerFitResult: { assessment: verdict.careerFit },
        preferenceFitResult: { assessment: verdict.preferenceFit },
        decision: verdict.decision,
        reasoning: verdict.reasoning,
        rulesApplied: [...decision.hardConstraints.checks.map((c) => c.key), "qualify_job_model"],
        modelVersion: usage.model,
      });

      const actionType: ActionType = verdict.decision === "qualified" ? "job.qualify" : "job.reject_mismatch";
      const authority = checkAuthority(actionType, authorityOverrides);
      await recordAudit(db, {
        actor: "qualification",
        eventType: verdict.decision === "qualified" ? "job.qualified" : "job.rejected",
        entityType: "job",
        entityId: job.id,
        action: `${verdict.decision === "qualified" ? "Qualified" : "Rejected"} ${job.company} — ${job.title}`,
        reason: verdict.reasoning,
        evidence: { hardConstraints: decision.hardConstraints, verdict, authority },
        policyReference: actionType,
      });
    }
  }

  return {
    stage: "qualification",
    ok: true,
    summary: `Evaluated ${counts.evaluated}: ${counts.qualified} qualified, ${counts.rejected} rejected (${counts.hardConstraintRejected} by hard constraint, ${counts.invalidModelOutput} invalid model outputs).`,
    counts,
  };
}
