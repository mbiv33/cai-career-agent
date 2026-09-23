import { describe, expect, it } from "vitest";
import type { ModelRequest, ModelResponse, ModelRunner } from "./runner.js";
import { FixtureSourceProvider, computeDedupeKey, normalizePosting } from "./discovery.js";
import type { DiscoveredPosting } from "@cai/core";

/** Canned, zero-cost runner — never calls a real model in tests. */
class FakeRunner implements ModelRunner {
  public calls: ModelRequest[] = [];
  constructor(private readonly response: ModelResponse) {}

  async run(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(req);
    return this.response;
  }
}

function posting(rawContent: unknown, overrides: Partial<DiscoveredPosting> = {}): DiscoveredPosting {
  return { source: "fixtures", rawContent, ...overrides };
}

describe("computeDedupeKey", () => {
  it("is stable for identical inputs", () => {
    const a = computeDedupeKey("Meridian Field Services", "Operations Trainee", "Riverside, TX");
    const b = computeDedupeKey("Meridian Field Services", "Operations Trainee", "Riverside, TX");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is case-insensitive", () => {
    const a = computeDedupeKey("Meridian Field Services", "Operations Trainee", "Riverside, TX");
    const b = computeDedupeKey("MERIDIAN FIELD SERVICES", "operations trainee", "riverside, tx");
    expect(a).toBe(b);
  });

  it("differs when any component differs", () => {
    const base = computeDedupeKey("Acme", "Operations Trainee", "Austin, TX");
    expect(computeDedupeKey("Acme Inc", "Operations Trainee", "Austin, TX")).not.toBe(base);
    expect(computeDedupeKey("Acme", "Operations Manager", "Austin, TX")).not.toBe(base);
    expect(computeDedupeKey("Acme", "Operations Trainee", "Dallas, TX")).not.toBe(base);
  });
});

describe("normalizePosting — deterministic path", () => {
  it("parses structured fields without calling the runner", async () => {
    const runner = new FakeRunner({ text: "{}", usage: { model: "unused", inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } });
    const raw = posting({
      company: "Meridian Field Services",
      title: "Operations Trainee",
      location: "Riverside, TX",
      compensationMin: 56000,
      compensationMax: 61000,
      workEnvironment: "field",
      employmentType: "full_time",
    });

    const result = await normalizePosting(runner, raw);

    expect(runner.calls).toHaveLength(0);
    expect(result).not.toBeNull();
    expect(result!.usedModel).toBe(false);
    expect(result!.valid).toBe(true);
    expect(result!.fields.compensationMin).toBe(56000);
    expect(result!.fields.compensationMax).toBe(61000);
    expect(result!.fields.workEnvironment).toBe("field");
  });

  it("returns null when company or title is missing (can't dedupe or insert)", async () => {
    const runner = new FakeRunner({ text: "{}", usage: { model: "unused", inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } });
    const raw = posting({ title: "Operations Trainee", compensationMin: 50000, workEnvironment: "field" });
    expect(await normalizePosting(runner, raw)).toBeNull();
  });
});

describe("normalizePosting — model path", () => {
  it("calls the runner for unstructured postings and validates the JSON result", async () => {
    const runner = new FakeRunner({
      text: JSON.stringify({ compensationMin: 54000, compensationMax: 60000, workEnvironment: "field" }),
      usage: { model: "fake:haiku", inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0 },
    });
    const raw = posting({
      company: "Union Freight Co",
      title: "Field Operations Associate",
      location: "Riverside, TX",
      rawDescription: "Active yard work, pay $54k-$60k, field-based.",
    });

    const result = await normalizePosting(runner, raw);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.task).toBe("normalize_posting");
    expect(result).not.toBeNull();
    expect(result!.usedModel).toBe(true);
    expect(result!.valid).toBe(true);
    expect(result!.fields.compensationMin).toBe(54000);
    expect(result!.fields.workEnvironment).toBe("field");
  });

  it("marks the result invalid (and skips normalization) on unparseable model output", async () => {
    const runner = new FakeRunner({
      text: "not json at all",
      usage: { model: "fake:haiku", inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0 },
    });
    const raw = posting({
      company: "Union Freight Co",
      title: "Field Operations Associate",
      rawDescription: "some unstructured text",
    });

    const result = await normalizePosting(runner, raw);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.fields).toEqual({});
  });

  it("marks the result invalid when the model returns wrongly-typed fields", async () => {
    const runner = new FakeRunner({
      text: JSON.stringify({ compensationMin: "fifty thousand" }),
      usage: { model: "fake:haiku", inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0 },
    });
    const raw = posting({ company: "Acme", title: "Trainee", rawDescription: "text" });

    const result = await normalizePosting(runner, raw);
    expect(result!.valid).toBe(false);
  });
});

describe("FixtureSourceProvider", () => {
  it("reads every fixture posting and stamps envelope fields from the raw JSON", async () => {
    const provider = new FixtureSourceProvider();
    const postings = await provider.fetchPostings({});

    expect(postings.length).toBeGreaterThanOrEqual(6);
    for (const p of postings) {
      expect(p.source).toBeTruthy();
      expect(p.rawContent).toBeTruthy();
    }
    const companies = postings.map((p) => (p.rawContent as { company?: string }).company);
    expect(companies).toContain("Meridian Field Services");
    expect(companies).toContain("Union Freight Co");
  });

  it("includes at least one low-pay and one desk-based fixture (constraint-failure coverage)", async () => {
    const provider = new FixtureSourceProvider();
    const postings = await provider.fetchPostings({});
    const raw = postings.map((p) => p.rawContent as Record<string, unknown>);

    expect(raw.some((r) => typeof r.compensationMax === "number" && r.compensationMax < 40000)).toBe(true);
    expect(raw.some((r) => r.workEnvironment === "desk")).toBe(true);
  });

  it("includes a cross-posted duplicate of another fixture (same company/title/location)", async () => {
    const provider = new FixtureSourceProvider();
    const postings = await provider.fetchPostings({});
    const keys = postings.map((p) => {
      const r = p.rawContent as { company?: string; title?: string; location?: string };
      return computeDedupeKey(r.company ?? "", r.title ?? "", r.location ?? "");
    });
    const counts = new Map<string, number>();
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    expect([...counts.values()].some((n) => n > 1)).toBe(true);
  });
});
