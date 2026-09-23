/**
 * Résumé tailoring (PRD FR-5, spec §5.6/§6 Application Agent). Selects a
 * baseline (optional, via `parentDocumentId` lineage) and asks the model to
 * tailor a résumé to a specific job using ONLY the candidate facts digest —
 * never the model's own judgment about what a candidate "probably" has done.
 * Output is verified against the digest before anything is stored; a
 * generation that cites an unknown fact, or is too sparsely cited, is
 * rejected outright (`FabricationGuardError`), never coerced or retried
 * silently.
 */
import type { Db } from "@cai/db";
import type { ActionType, AuthorityLevel } from "@cai/core";
import type { ModelRunner } from "@cai/agents";
import { buildFactsDigest, extractFactIdsFromDigest } from "./facts-digest.js";
import { verifyCitations } from "./fabrication-guard.js";
import { FabricationGuardError } from "./errors.js";
import { loadJob, persistGuardedDocument, recordFabricationRejection, type DocumentRow, type JobRow } from "./shared.js";

export const RESUME_SYSTEM_PROMPT = `You are the résumé-tailoring agent for a job-search assistant.

You will be given a CANDIDATE FACTS DIGEST — the ONLY true information about the candidate,
grouped by category, with every line tagged with a [fact:<id>] citation — and a TARGET JOB.

Hard rule: never invent or embellish candidate qualifications, experience, skills, or
accomplishments. Use ONLY facts from the digest. Every bullet line must end with the [fact:<id>]
tag(s) of the digest line(s) it draws from, e.g.:
"- Led a 12-person field crew through daily route operations [fact:abc123]"
If the job asks for something the candidate lacks, omit it entirely — never invent it and never
imply it through vague phrasing.

Output ONLY the résumé itself, in markdown (a header, then sectioned bullet lists). No prose
outside the résumé, no commentary, no markdown code fences.`;

function buildJobBrief(job: JobRow): string {
  return JSON.stringify(
    {
      company: job.company,
      title: job.title,
      location: job.location,
      employmentType: job.employmentType,
      responsibilities: job.responsibilities,
      minimumRequirements: job.minimumRequirements,
      preferredRequirements: job.preferredRequirements,
      careerPath: job.careerPath,
    },
    null,
    2,
  );
}

function buildResumePrompt(job: JobRow, digest: string): string {
  return [
    "CANDIDATE FACTS DIGEST (the ONLY source of truth about this candidate):",
    digest,
    "",
    "TARGET JOB:",
    buildJobBrief(job),
  ].join("\n");
}

export interface TailorResumeInput {
  candidateId: string;
  jobId: string;
  /** Prior résumé document this tailoring builds on, for version lineage. */
  baselineDocumentId?: string;
  /** Actor recorded on the audit trail; defaults to the application agent. */
  actor?: string;
  runId?: string;
  authorityOverrides?: Partial<Record<ActionType, AuthorityLevel>>;
}

export async function tailorResume(db: Db, runner: ModelRunner, input: TailorResumeInput): Promise<DocumentRow> {
  const actor = input.actor ?? "application";
  const job = await loadJob(db, input.jobId);

  const digest = await buildFactsDigest(db, input.candidateId);
  const validFactIds = extractFactIdsFromDigest(digest);

  const response = await runner.run({
    task: "tailor_resume",
    system: RESUME_SYSTEM_PROMPT,
    prompt: buildResumePrompt(job, digest),
  });

  let guard;
  try {
    guard = verifyCitations(response.text, validFactIds, "resume");
  } catch (err) {
    if (err instanceof FabricationGuardError) {
      await recordFabricationRejection({
        db,
        actor,
        jobId: job.id,
        kind: "resume",
        task: "tailor_resume",
        runId: input.runId,
        response,
        error: err,
        policyReference: "resume.tailor",
      });
    }
    throw err;
  }

  return persistGuardedDocument({
    db,
    candidateId: input.candidateId,
    kind: "resume",
    title: `Résumé — ${job.company} — ${job.title}`,
    parentDocumentId: input.baselineDocumentId,
    jobId: job.id,
    guard,
    response,
    task: "tailor_resume",
    actor,
    runId: input.runId,
    policyReference: "resume.tailor",
    authorityOverrides: input.authorityOverrides,
  });
}
