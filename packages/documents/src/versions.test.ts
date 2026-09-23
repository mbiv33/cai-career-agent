import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertFact } from "@cai/knowledge";
import type { ModelRequest, ModelResponse, ModelRunner } from "@cai/agents";
import { tailorResume } from "./resume.js";
import { getDocumentLineage, latestResumeFor } from "./versions.js";
import {
  cleanupTestCandidate,
  cleanupTestJob,
  createTestCandidate,
  createTestJob,
  db,
  type TestCandidate,
  type TestJob,
} from "./test-db.js";

class FakeRunner implements ModelRunner {
  constructor(private readonly response: ModelResponse) {}
  async run(_req: ModelRequest): Promise<ModelResponse> {
    return this.response;
  }
}

const USAGE = { model: "fake:sonnet", inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0 };

function resumeResponse(factId: string, label: string): ModelResponse {
  return {
    text: `# Résumé (${label})\n- Relevant experience [fact:${factId}]`,
    usage: USAGE,
  };
}

describe("document version lineage", () => {
  let candidate: TestCandidate;
  let job: TestJob;
  let factId: string;

  beforeAll(async () => {
    candidate = await createTestCandidate("versions");
    job = await createTestJob({ company: "Versioned Co", title: "Versioned Role" });
    const fact = await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "employment",
      key: "prior_role",
      value: { title: "Ops Associate", employer: "Prior Co", start: 2020, end: 2023 },
      sourceType: "candidate_confirmed",
      actor: "test",
    });
    factId = fact.id;
  });

  afterAll(async () => {
    await cleanupTestCandidate(candidate);
    await cleanupTestJob(job.id);
    await rm(path.join("var", "documents", candidate.candidateId), { recursive: true, force: true });
  });

  it("walks a 3-version chain from root to leaf via getDocumentLineage, and latestResumeFor returns the newest", async () => {
    const v1 = await tailorResume(db, new FakeRunner(resumeResponse(factId, "v1")), {
      candidateId: candidate.candidateId,
      jobId: job.id,
    });

    const v2 = await tailorResume(db, new FakeRunner(resumeResponse(factId, "v2")), {
      candidateId: candidate.candidateId,
      jobId: job.id,
      baselineDocumentId: v1.id,
    });

    const v3 = await tailorResume(db, new FakeRunner(resumeResponse(factId, "v3")), {
      candidateId: candidate.candidateId,
      jobId: job.id,
      baselineDocumentId: v2.id,
    });

    const lineageFromLeaf = await getDocumentLineage(db, v3.id);
    expect(lineageFromLeaf.map((d) => d.id)).toEqual([v1.id, v2.id, v3.id]);

    const lineageFromRoot = await getDocumentLineage(db, v1.id);
    expect(lineageFromRoot.map((d) => d.id)).toEqual([v1.id]);

    const latest = await latestResumeFor(db, candidate.candidateId, job.id);
    expect(latest?.id).toBe(v3.id);
  });

  it("returns an empty array for an unknown document id", async () => {
    const lineage = await getDocumentLineage(db, "00000000-0000-0000-0000-000000000000");
    expect(lineage).toEqual([]);
  });
});
