import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertFact } from "@cai/knowledge";
import type { ModelRequest, ModelResponse, ModelRunner } from "@cai/agents";
import { FabricationGuardError } from "./errors.js";
import { generateCoverLetter } from "./cover-letter.js";
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
  public calls: ModelRequest[] = [];
  constructor(private readonly response: ModelResponse) {}

  async run(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(req);
    return this.response;
  }
}

const USAGE = { model: "fake:sonnet", inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0 };

describe("generateCoverLetter", () => {
  let candidate: TestCandidate;
  let job: TestJob;
  let factId: string;

  beforeAll(async () => {
    candidate = await createTestCandidate("cover-letter");
    job = await createTestJob({ company: "Northline Logistics", title: "Field Operations Associate" });

    const fact = await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "athletic",
      key: "college_athletics",
      value: { sport: "Track & Field", level: "NCAA", years: 4 },
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

  it("rejects a letter that cites no candidate facts at all", async () => {
    const runner = new FakeRunner({
      text: "Dear Hiring Manager,\n\nI would be a great fit for this role.\n\nSincerely,\nCandidate",
      usage: USAGE,
    });

    await expect(
      generateCoverLetter(db, runner, { candidateId: candidate.candidateId, jobId: job.id }),
    ).rejects.toThrow(FabricationGuardError);
  });

  it("rejects a letter citing a fact id absent from the digest", async () => {
    const runner = new FakeRunner({
      text: `Dear Hiring Manager,\n\nMy background [fact:${factId}] and also [fact:invented-id] fit this role.\n\nSincerely,\nCandidate`,
      usage: USAGE,
    });

    await expect(
      generateCoverLetter(db, runner, { candidateId: candidate.candidateId, jobId: job.id }),
    ).rejects.toThrow(FabricationGuardError);
  });

  it("stores the letter, strips citation tags, and records the real cited facts on the happy path", async () => {
    const runner = new FakeRunner({
      text: [
        "Dear Northline Logistics team,",
        "",
        `My four years of NCAA Track & Field [fact:${factId}] built the discipline this Field Operations`,
        "Associate role calls for.",
        "",
        "Sincerely,",
        "Candidate",
      ].join("\n"),
      usage: USAGE,
    });

    const doc = await generateCoverLetter(db, runner, { candidateId: candidate.candidateId, jobId: job.id });

    expect(doc.kind).toBe("cover_letter");
    expect(doc.contentText).not.toMatch(/\[fact:/);
    expect(doc.contentText).toContain("NCAA Track & Field");

    const meta = doc.meta as Record<string, unknown>;
    expect(meta.citations).toEqual([factId]);
    expect(meta.jobId).toBe(job.id);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.task).toBe("generate_cover_letter");
  });
});
