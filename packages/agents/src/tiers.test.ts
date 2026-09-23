import { describe, expect, it } from "vitest";
import { estimateCostUsd, TASK_TIERS } from "./tiers.js";

describe("model tiering", () => {
  it("keeps high-volume tasks on haiku", () => {
    expect(TASK_TIERS.normalize_posting).toBe("haiku");
    expect(TASK_TIERS.classify_email).toBe("haiku");
  });

  it("reserves opus for strategy only", () => {
    const opusTasks = Object.entries(TASK_TIERS).filter(([, t]) => t === "opus");
    expect(opusTasks).toEqual([["strategy_analysis", "opus"]]);
  });

  it("estimates cost from pricing table", () => {
    // 1M input + 1M output on sonnet = $2 + $10
    expect(estimateCostUsd("sonnet", 1_000_000, 1_000_000)).toBe(12);
    expect(estimateCostUsd("haiku", 500_000, 100_000)).toBeCloseTo(1.0);
  });
});
