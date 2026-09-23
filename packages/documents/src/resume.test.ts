import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditEvents } from "@cai/db";
import { upsertFact } from "@cai/knowledge";
import type { ModelRequest, ModelResponse, ModelRunner } from "@cai/agents";
import { FabricationGuardError } from "./errors.js";
import { loadDocument } from "./storage.js";
import { tailorResume } from "./resume.js";
import {
  cleanupTestCandidate,
  cleanupTestJob,
  createTestCandidate,
  createTestJob,
  db,
  type TestCandidate,
  type TestJob,
} from "./test-db.js";

/** Canned, zero-cost runner — never calls a real model in tests. */
class FakeRunner implements ModelRunner {
  public calls: ModelRequest[] = [];
  constructor(private readonly response: ModelResponse) {}

  async run(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(req);
    return this.response;
  }
}

const USAGE = { model: "fake:sonnet", inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0 };

describe("tailorResume", () => {
  let candidate: TestCandidate;
  let job: TestJob;
  let factId: string;
  let secondFactId: string;

  beforeAll(async () => {
    candidate = await createTestCandidate("resume");
    job = await createTestJob({ company: "Acme Field Ops", title: "Field Coordinator" });

    const fact = await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "employment",
      key: "prior_role",
      value: { title: "Crew Lead", employer: "Trailblazer Logistics", start: 2021, end: 2024 },
      sourceType: "candidate_confirmed",
      actor: "test",
    });
    factId = fact.id;

    const secondFact = await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "education",
      key: "degree",
      value: { school: "State University", degree: "B.S.", field: "Kinesiology", year: 2024 },
      sourceType: "candidate_confirmed",
      actor: "test",
    });
    secondFactId = secondFact.id;
  });

  afterAll(async () => {
    await cleanupTestCandidate(candidate);
    await cleanupTestJob(job.id);
    await rm(path.join("var", "documents", candidate.candidateId), { recursive: true, force: true });
  });

  it("rejects generation that cites a fact id not present in the digest", async () => {
    const runner = new FakeRunner({
      text: "# Résumé\n- Led field operations for a large crew [fact:not-a-real-id]\n- Managed logistics [fact:not-a-real-id]",
      usage: USAGE,
    });

    await expect(
      tailorResume(db, runner, { candidateId: candidate.candidateId, jobId: job.id }),
    ).rejects.toThrow(FabricationGuardError);

    const rejectionAudits = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.eventType, "document.generation_rejected"), eq(auditEvents.entityId, job.id)));
    expect(rejectionAudits.length).toBeGreaterThan(0);
    expect(rejectionAudits[0]!.reason).toMatch(/not-a-real-id/);
  });

  it("rejects generation where fewer than half the bullet lines carry a citation", async () => {
    const runner = new FakeRunner({
      text: [
        "# Résumé",
        `- Crew lead role [fact:${factId}]`,
        "- Uncited bullet one",
        "- Uncited bullet two",
        "- Uncited bullet three",
      ].join("\n"),
      usage: USAGE,
    });

    await expect(
      tailorResume(db, runner, { candidateId: candidate.candidateId, jobId: job.id }),
    ).rejects.toThrow(FabricationGuardError);
  });

  it("stores the document, writes the file, and strips citation tags on the happy path", async () => {
    const runner = new FakeRunner({
      text: [
        "# Résumé",
        "## Experience",
        `- Led logistics crews at Trailblazer Logistics [fact:${factId}]`,
        `- B.S. in Kinesiology, State University [fact:${secondFactId}]`,
      ].join("\n"),
      usage: USAGE,
    });

    const doc = await tailorResume(db, runner, { candidateId: candidate.candidateId, jobId: job.id });

    expect(doc.kind).toBe("resume");
    expect(doc.candidateId).toBe(candidate.candidateId);
    expect(doc.contentText).not.toMatch(/\[fact:/);
    expect(doc.contentText).toContain("Trailblazer Logistics");

    const meta = doc.meta as Record<string, unknown>;
    expect(meta.jobId).toBe(job.id);
    expect(meta.model).toBe(USAGE.model);
    expect(meta.citations).toEqual([factId, secondFactId]);
    expect(typeof meta.citedSource).toBe("string");
    expect(meta.citedSource as string).toMatch(/\[fact:/);

    const fileContent = await loadDocument(doc.storagePath);
    expect(fileContent).toBe(doc.contentText);
    expect(fileContent).not.toMatch(/\[fact:/);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.task).toBe("tailor_resume");
  });
});
