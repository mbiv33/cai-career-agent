import { describe, expect, it } from "vitest";
import type { ModelRequest, ModelResponse, ModelRunner } from "./runner.js";
import {
  evaluateHardConstraints,
  evaluateJob,
  parseQualificationVerdict,
  type PreferenceLike,
} from "./qualification.js";

/** Canned, zero-cost runner — never calls a real model in tests. */
class FakeRunner implements ModelRunner {
  public calls: ModelRequest[] = [];
  constructor(private readonly response: ModelResponse) {}

  async run(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(req);
    return this.response;
  }
}

function pref(overrides: Partial<PreferenceLike>): PreferenceLike {
  return { type: "compensation", value: {}, strength: "hard_constraint", active: true, ...overrides };
}

const compensationFloor = (minimum: number) =>
  pref({ type: "compensation", value: { minimum }, strength: "hard_constraint" });

const workEnvironmentRequired = (required: string[]) =>
  pref({ type: "work_environment", value: { required }, strength: "hard_constraint" });

describe("evaluateHardConstraints — compensation floor", () => {
  it("passes when the job's best-case pay meets the floor", () => {
    const result = evaluateHardConstraints(
      { compensationMin: 52000, compensationMax: 58000 },
      [compensationFloor(50000)],
    );
    expect(result.passed).toBe(true);
    expect(result.checks.find((c) => c.key === "compensation_floor")?.result).toBe("pass");
  });

  it("fails when the job's best-case pay is below the floor", () => {
    const result = evaluateHardConstraints(
      { compensationMin: 34000, compensationMax: 38000 },
      [compensationFloor(50000)],
    );
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.key === "compensation_floor")?.result).toBe("fail");
  });

  it("is not_applicable when the job has no compensation data", () => {
    const result = evaluateHardConstraints({}, [compensationFloor(50000)]);
    expect(result.passed).toBe(true);
    expect(result.checks.find((c) => c.key === "compensation_floor")?.result).toBe("not_applicable");
  });

  it("ignores soft (non hard_constraint) compensation preferences", () => {
    const result = evaluateHardConstraints(
      { compensationMin: 10000, compensationMax: 12000 },
      [pref({ type: "compensation", value: { minimum: 50000 }, strength: "preference" })],
    );
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(0);
  });

  it("ignores inactive hard-constraint preferences", () => {
    const inactive = { ...compensationFloor(50000), active: false };
    const result = evaluateHardConstraints({ compensationMin: 10000, compensationMax: 12000 }, [inactive]);
    expect(result.passed).toBe(true);
  });
});

describe("evaluateHardConstraints — work environment", () => {
  it("fails a desk-based job when field work is required", () => {
    const result = evaluateHardConstraints({ workEnvironment: "desk" }, [workEnvironmentRequired(["field"])]);
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.key === "work_environment")?.result).toBe("fail");
  });

  it("passes a field-based job when field work is required", () => {
    const result = evaluateHardConstraints({ workEnvironment: "field" }, [workEnvironmentRequired(["field"])]);
    expect(result.passed).toBe(true);
  });

  it("fails when the environment is explicitly excluded", () => {
    const result = evaluateHardConstraints(
      { workEnvironment: "desk" },
      [pref({ type: "work_environment", value: { excluded: ["desk"] }, strength: "hard_constraint" })],
    );
    expect(result.passed).toBe(false);
  });
});

describe("evaluateHardConstraints — combined", () => {
  it("fails overall if either compensation or environment fails, listing both checks", () => {
    const result = evaluateHardConstraints(
      { compensationMin: 30000, compensationMax: 35000, workEnvironment: "desk" },
      [compensationFloor(50000), workEnvironmentRequired(["field"])],
    );
    expect(result.passed).toBe(false);
    expect(result.checks).toHaveLength(2);
    expect(result.checks.every((c) => c.result === "fail")).toBe(true);
  });
});

describe("parseQualificationVerdict", () => {
  it("accepts a well-formed verdict", () => {
    const verdict = parseQualificationVerdict(
      JSON.stringify({ decision: "qualified", reasoning: "Good fit.", careerFit: "advances goal", preferenceFit: "match" }),
    );
    expect(verdict).toEqual({ decision: "qualified", reasoning: "Good fit.", careerFit: "advances goal", preferenceFit: "match" });
  });

  it("rejects invalid JSON", () => {
    expect(parseQualificationVerdict("not json")).toBeNull();
  });

  it("rejects a decision outside the enum", () => {
    expect(parseQualificationVerdict(JSON.stringify({ decision: "maybe", reasoning: "x" }))).toBeNull();
  });

  it("rejects output missing reasoning", () => {
    expect(parseQualificationVerdict(JSON.stringify({ decision: "qualified" }))).toBeNull();
  });
});

describe("evaluateJob — hard constraint short-circuit", () => {
  it("rejects without ever calling the runner when a hard constraint fails", async () => {
    const runner = new FakeRunner({
      text: JSON.stringify({ decision: "qualified", reasoning: "should never be reached" }),
      usage: { model: "fake:sonnet", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
    });

    const decision = await evaluateJob(
      runner,
      { compensationMin: 34000, compensationMax: 38000, workEnvironment: "desk" },
      [compensationFloor(50000)],
    );

    expect(runner.calls).toHaveLength(0);
    expect(decision.outcome.kind).toBe("hard_constraint_rejected");
    if (decision.outcome.kind === "hard_constraint_rejected") {
      expect(decision.outcome.reasoning.length).toBeGreaterThan(0);
      expect(decision.outcome.reasoning).toMatch(/below the/);
    }
  });
});

describe("evaluateJob — model path", () => {
  it("calls the runner and returns a reasoning-bearing verdict when hard constraints pass", async () => {
    const runner = new FakeRunner({
      text: JSON.stringify({
        decision: "qualified",
        reasoning: "Field-based role within compensation range; advances field-operations goal.",
        careerFit: "advances goal",
        preferenceFit: "match",
      }),
      usage: { model: "fake:sonnet", inputTokens: 100, outputTokens: 40, estimatedCostUsd: 0 },
    });

    const decision = await evaluateJob(
      runner,
      { compensationMin: 56000, compensationMax: 61000, workEnvironment: "field" },
      [compensationFloor(50000)],
    );

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.task).toBe("qualify_job");
    expect(decision.outcome.kind).toBe("model_decided");
    if (decision.outcome.kind === "model_decided") {
      expect(decision.outcome.verdict.decision).toBe("qualified");
      expect(decision.outcome.verdict.reasoning.length).toBeGreaterThan(0);
    }
  });

  it("treats invalid model JSON as invalid_model_output, not a silent decision", async () => {
    const runner = new FakeRunner({
      text: "not json",
      usage: { model: "fake:sonnet", inputTokens: 100, outputTokens: 40, estimatedCostUsd: 0 },
    });

    const decision = await evaluateJob(
      runner,
      { compensationMin: 56000, compensationMax: 61000, workEnvironment: "field" },
      [compensationFloor(50000)],
    );

    expect(decision.outcome.kind).toBe("invalid_model_output");
  });
});
