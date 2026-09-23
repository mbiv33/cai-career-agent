/**
 * Cover letter generation (PRD FR-5, spec §5.6/§6 Application Agent). Same
 * guarded pattern as résumé tailoring — the model sees only the candidate
 * facts digest, cites what it draws on, and the guard rejects any citation
 * of a fact id absent from the digest or a letter that cites nothing at all.
 * Shorter output than a résumé; tone is direct and warm, not sales copy.
 */
import type { Db } from "@cai/db";
import type { ActionType, AuthorityLevel } from "@cai/core";
import type { ModelRunner } from "@cai/agents";
import { buildFactsDigest, extractFactIdsFromDigest } from "./facts-digest.js";
import { verifyCitations } from "./fabrication-guard.js";
import { FabricationGuardError } from "./errors.js";
import { loadJob, persistGuardedDocument, recordFabricationRejection, type DocumentRow, type JobRow } from "./shared.js";

export const COVER_LETTER_SYSTEM_PROMPT = `You are the cover-letter-generation agent for a job-search assistant.

You will be given a CANDIDATE FACTS DIGEST — the ONLY true information about the candidate,
grouped by category, with every line tagged with a [fact:<id>] citation — and a TARGET JOB.

Hard rule: never invent or embellish candidate qualifications, experience, skills, or
accomplishments. Reference at most 2-3 concrete facts from the digest, each inline-cited with
its [fact:<id>] tag, plus the specific company and role by name. If the job asks for something
the candidate lacks, omit it entirely — never invent it and never imply it.

Tone: direct and warm. No clichés ("dynamic team player", "perfect fit", "passionate about").
Keep it to 3-4 short paragraphs with a simple greeting and sign-off — no letterhead boilerplate.

Output ONLY the letter itself, in markdown prose. No commentary, no markdown code fences.`;

function buildJobBrief(job: JobRow): string {
  return JSON.stringify(
    {
      company: job.company,
      title: job.title,
      location: job.location,
      responsibilities: job.responsibilities,
      minimumRequirements: job.minimumRequirements,
      preferredRequirements: job.preferredRequirements,
    },
    null,
    2,
  );
}

function buildCoverLetterPrompt(job: JobRow, digest: string): string {
  return [
    "CANDIDATE FACTS DIGEST (the ONLY source of truth about this candidate):",
    digest,
    "",
    "TARGET JOB:",
    buildJobBrief(job),
  ].join("\n");
}

export interface GenerateCoverLetterInput {
  candidateId: string;
  jobId: string;
  /** Prior cover letter document this generation builds on, for version lineage. */
  baselineDocumentId?: string;
  /** Actor recorded on the audit trail; defaults to the application agent. */
  actor?: string;
  runId?: string;
  authorityOverrides?: Partial<Record<ActionType, AuthorityLevel>>;
}

export async function generateCoverLetter(
  db: Db,
  runner: ModelRunner,
  input: GenerateCoverLetterInput,
): Promise<DocumentRow> {
  const actor = input.actor ?? "application";
  const job = await loadJob(db, input.jobId);

  const digest = await buildFactsDigest(db, input.candidateId);
  const validFactIds = extractFactIdsFromDigest(digest);

  const response = await runner.run({
    task: "generate_cover_letter",
    system: COVER_LETTER_SYSTEM_PROMPT,
    prompt: buildCoverLetterPrompt(job, digest),
  });

  let guard;
  try {
    guard = verifyCitations(response.text, validFactIds, "cover_letter");
  } catch (err) {
    if (err instanceof FabricationGuardError) {
      await recordFabricationRejection({
        db,
        actor,
        jobId: job.id,
        kind: "cover_letter",
        task: "generate_cover_letter",
        runId: input.runId,
        response,
        error: err,
        policyReference: "cover_letter.generate",
      });
    }
    throw err;
  }

  return persistGuardedDocument({
    db,
    candidateId: input.candidateId,
    kind: "cover_letter",
    title: `Cover Letter — ${job.company} — ${job.title}`,
    parentDocumentId: input.baselineDocumentId,
    jobId: job.id,
    guard,
    response,
    task: "generate_cover_letter",
    actor,
    runId: input.runId,
    policyReference: "cover_letter.generate",
    authorityOverrides: input.authorityOverrides,
  });
}
