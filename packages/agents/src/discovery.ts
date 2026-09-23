/**
 * Discovery stage (PRD FR-2/FR-3, spec §6 Discovery Agent).
 *
 * Pulls raw postings from a JobSourceProvider, normalizes them into the Job
 * shape (deterministically where the source already gives structured
 * fields, via a haiku model call only for unstructured free text), dedupes
 * across sources by (company, title, location), and writes
 * DISCOVERED -> NORMALIZED jobs with a full audit trail.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import type { Db } from "@cai/db";
import { jobs, jobSnapshots } from "@cai/db";
import {
  assertTransition,
  createEscalation,
  recordAudit,
  type DiscoveredPosting,
  type StageResult,
  type TokenUsage,
} from "@cai/core";
import type { ModelRunner } from "./runner.js";
import { logModelCall } from "./token-log.js";
import { asRecord, bump, num, str } from "./json-utils.js";

const DEFAULT_FIXTURES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/postings",
);

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Any source of raw postings the discovery stage can pull from. Stage 2
 * adds real providers (career sites, aggregators); Stage 1 ships the fixture
 * source so the pipeline is fully exercisable in dev/CI without network
 * access or paid infrastructure (CLAUDE.md cost cap). */
export interface JobSourceProvider {
  fetchPostings(strategyConfig: unknown): Promise<DiscoveredPosting[]>;
}

/** Reads canned posting JSON files from `packages/agents/fixtures/postings`.
 * Each file is the raw posting payload as a real source would hand it back —
 * some fully structured, some with a `rawDescription` blob that only a model
 * call can parse — plus an envelope of `source` / `sourceUrl` / `externalJobId`. */
export class FixtureSourceProvider implements JobSourceProvider {
  constructor(private readonly fixturesDir: string = DEFAULT_FIXTURES_DIR) {}

  async fetchPostings(_strategyConfig?: unknown): Promise<DiscoveredPosting[]> {
    let entries: string[];
    try {
      entries = await readdir(this.fixturesDir);
    } catch {
      return [];
    }
    const files = entries.filter((f) => f.endsWith(".json")).sort();

    const postings: DiscoveredPosting[] = [];
    for (const file of files) {
      const raw = await readFile(resolve(this.fixturesDir, file), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      postings.push({
        source: str(parsed.source) ?? "fixtures",
        sourceUrl: str(parsed.sourceUrl),
        externalJobId: str(parsed.externalJobId),
        rawContent: parsed,
      });
    }
    return postings;
  }
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

/** Stable cross-posting dedupe key (spec §5.3 dedupe_key). Same formula the
 * seed script uses: sha256 of lowercased "company|title|location". */
export function computeDedupeKey(company: string, title: string, location: string): string {
  return createHash("sha256")
    .update(`${company}|${title}|${location}`.toLowerCase())
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Fields the Job object needs beyond company/title/location (spec §5.3). */
export interface NormalizedFields {
  compensationMin?: number;
  compensationMax?: number;
  employmentType?: string;
  schedule?: string;
  travel?: string;
  workEnvironment?: string;
  responsibilities?: unknown;
  minimumRequirements?: unknown;
  preferredRequirements?: unknown;
  physicalRequirements?: unknown;
  careerPath?: string;
  applicationUrl?: string;
  postingDate?: string;
}

const NORMALIZE_SYSTEM_PROMPT = `You convert a raw job posting into strict JSON.
Return ONLY a JSON object (no prose, no markdown fences) with these optional keys:
compensationMin (number), compensationMax (number), employmentType (string),
schedule (string), travel (string), workEnvironment (string: "field" | "desk" | "hybrid" | "remote" | other),
responsibilities (string[]), minimumRequirements (string[]), preferredRequirements (string[]),
physicalRequirements (string[]), careerPath (string), applicationUrl (string), postingDate (ISO date string).
Omit keys you cannot determine from the text. Never invent facts not present in the posting.`;

function parseStructuredFields(record: Record<string, unknown>): NormalizedFields {
  return {
    compensationMin: num(record.compensationMin),
    compensationMax: num(record.compensationMax),
    employmentType: str(record.employmentType),
    schedule: str(record.schedule),
    travel: str(record.travel),
    workEnvironment: str(record.workEnvironment),
    responsibilities: record.responsibilities,
    minimumRequirements: record.minimumRequirements,
    preferredRequirements: record.preferredRequirements,
    physicalRequirements: record.physicalRequirements,
    careerPath: str(record.careerPath),
    applicationUrl: str(record.applicationUrl),
    postingDate: str(record.postingDate),
  };
}

/** True when the raw posting already carries enough structured data to skip
 * the model entirely — the common case for API/aggregator sources. */
function isStructured(record: Record<string, unknown>): boolean {
  return num(record.compensationMin) !== undefined && str(record.workEnvironment) !== undefined;
}

/** Rejects model output that isn't even shaped like our field set, rather
 * than silently coercing garbage into the jobs table. */
function validateNormalizedFields(value: unknown): NormalizedFields | null {
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ["compensationMin", "compensationMax"] as const) {
    if (key in record && record[key] !== undefined && typeof record[key] !== "number") return null;
  }
  return parseStructuredFields(record);
}

export interface NormalizationResult {
  company: string;
  title: string;
  location: string | undefined;
  fields: NormalizedFields;
  /** False when a model call was required and its output failed validation
   * (bad/absent JSON). Callers should not transition the job on `false`. */
  valid: boolean;
  usedModel: boolean;
  usage?: TokenUsage;
}

/**
 * Deterministic where the raw posting already has structured fields;
 * otherwise calls the model (`normalize_posting`, haiku tier) on the
 * unstructured text. Returns `null` only when the posting is missing the
 * bare minimum (company/title) needed to even dedupe it — those postings
 * can't be turned into a Job row at all and are skipped upstream.
 */
export async function normalizePosting(
  runner: ModelRunner,
  raw: DiscoveredPosting,
): Promise<NormalizationResult | null> {
  const record = asRecord(raw.rawContent);
  if (!record) return null;
  const company = str(record.company);
  const title = str(record.title);
  if (!company || !title) return null;
  const location = str(record.location);

  if (isStructured(record)) {
    return { company, title, location, fields: parseStructuredFields(record), valid: true, usedModel: false };
  }

  const rawDescription = str(record.rawDescription) ?? "";
  const response = await runner.run({
    task: "normalize_posting",
    system: NORMALIZE_SYSTEM_PROMPT,
    prompt: JSON.stringify({ company, title, location, rawDescription }),
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(response.text);
  } catch {
    return { company, title, location, fields: {}, valid: false, usedModel: true, usage: response.usage };
  }
  const fields = validateNormalizedFields(parsedJson);
  if (!fields) {
    return { company, title, location, fields: {}, valid: false, usedModel: true, usage: response.usage };
  }
  return { company, title, location, fields, valid: true, usedModel: true, usage: response.usage };
}

// ---------------------------------------------------------------------------
// Stage runner
// ---------------------------------------------------------------------------

export interface DiscoveryStageDeps {
  db: Db;
  runner: ModelRunner;
  candidateId: string;
  runId: string;
  dryRun: boolean;
  provider?: JobSourceProvider;
}

export async function runDiscoveryStage(deps: DiscoveryStageDeps): Promise<StageResult> {
  const { db, runner, candidateId, runId, dryRun } = deps;
  const provider = deps.provider ?? new FixtureSourceProvider();

  const counts: Record<string, number> = {
    discovered: 0,
    deduped: 0,
    normalized: 0,
    normalizationFailed: 0,
    skippedInvalid: 0,
    escalationsCreated: 0,
  };

  const postings = await provider.fetchPostings({ candidateId });
  // In-memory dedup so --dry-run (which never touches the DB) still reports
  // accurate counts for cross-posted fixtures within the same run.
  const seenThisRun = new Set<string>();

  for (const posting of postings) {
    const normalization = await normalizePosting(runner, posting);
    if (!normalization) {
      bump(counts, "skippedInvalid");
      continue;
    }
    const { company, title, location, fields, valid, usedModel, usage } = normalization;
    const dedupeKey = computeDedupeKey(company, title, location ?? "");

    if (seenThisRun.has(dedupeKey)) {
      bump(counts, "deduped");
      continue;
    }
    seenThisRun.add(dedupeKey);

    if (!dryRun) {
      const existing = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.dedupeKey, dedupeKey));
      if (existing.length > 0) {
        bump(counts, "deduped");
        continue;
      }
    }

    bump(counts, "discovered");

    let jobId: string | undefined;
    if (!dryRun) {
      const [inserted] = await db
        .insert(jobs)
        .values({
          externalJobId: posting.externalJobId,
          company,
          title,
          location,
          source: posting.source,
          sourceUrl: posting.sourceUrl,
          status: "DISCOVERED",
          dedupeKey,
        })
        // Belt-and-suspenders against a race with a concurrent run — the
        // pre-check above is the primary dedup path.
        .onConflictDoNothing({ target: jobs.dedupeKey })
        .returning({ id: jobs.id });

      if (!inserted) {
        bump(counts, "discovered", -1);
        bump(counts, "deduped");
        continue;
      }
      jobId = inserted.id;

      await db.insert(jobSnapshots).values({
        jobId,
        rawContent: posting.rawContent as object,
      });

      await recordAudit(db, {
        actor: "discovery",
        eventType: "job.discovered",
        entityType: "job",
        entityId: jobId,
        action: `Discovered ${company} — ${title}`,
        evidence: { source: posting.source, sourceUrl: posting.sourceUrl },
      });
    }

    if (usedModel && usage && !dryRun) {
      await logModelCall(db, {
        agent: "discovery",
        task: "normalize_posting",
        runId,
        usage,
        summary: `Normalized ${company} — ${title}`,
      });
    }

    if (!valid) {
      bump(counts, "normalizationFailed");
      if (!dryRun && jobId) {
        await createEscalation(db, {
          candidateId,
          jobId,
          type: "NORMALIZATION_FAILURE",
          priority: "UPDATE",
          reason: `Could not extract structured fields for ${company} — ${title}.`,
          requiredInput: "Review the raw posting and normalize manually, or discard it.",
          raisedBy: "discovery",
        });
        bump(counts, "escalationsCreated");
        await recordAudit(db, {
          actor: "discovery",
          eventType: "job.normalization_failed",
          entityType: "job",
          entityId: jobId,
          action: `Normalization failed for ${company} — ${title}; left in DISCOVERED`,
          reason: "Model output was not valid normalized-fields JSON.",
        });
      }
      continue; // stays DISCOVERED — no transition on bad model output
    }

    bump(counts, "normalized");
    if (!dryRun && jobId) {
      assertTransition("DISCOVERED", "NORMALIZED");
      await db
        .update(jobs)
        .set({
          compensationMin: fields.compensationMin,
          compensationMax: fields.compensationMax,
          employmentType: fields.employmentType,
          schedule: fields.schedule,
          travel: fields.travel,
          workEnvironment: fields.workEnvironment,
          responsibilities: fields.responsibilities,
          minimumRequirements: fields.minimumRequirements,
          preferredRequirements: fields.preferredRequirements,
          physicalRequirements: fields.physicalRequirements,
          careerPath: fields.careerPath,
          applicationUrl: fields.applicationUrl,
          postingDate: fields.postingDate ? new Date(fields.postingDate) : undefined,
          status: "NORMALIZED",
        })
        .where(eq(jobs.id, jobId));

      await recordAudit(db, {
        actor: "discovery",
        eventType: "job.normalized",
        entityType: "job",
        entityId: jobId,
        action: `Normalized ${company} — ${title}`,
        evidence: { usedModel },
      });
    }
  }

  return {
    stage: "discovery",
    ok: true,
    summary: `Discovered ${counts.discovered}, normalized ${counts.normalized}, deduped ${counts.deduped}, normalization failures ${counts.normalizationFailed}.`,
    counts,
  };
}
