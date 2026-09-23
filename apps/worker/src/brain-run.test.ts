import { describe, expect, it } from "vitest";
import type { Db } from "@cai/db";
import type { ModelRunner } from "@cai/agents";
import type { BrainRunConfig } from "@cai/core";
import { runBrainRun } from "./brain-run.js";

/** Never touched in these tests — stub stages don't read/write the DB, and
 * dryRun:true skips the final audit write. */
const UNUSED_DB = undefined as unknown as Db;

const NEVER_CALLED_RUNNER: ModelRunner = {
  async run() {
    throw new Error("runner should not be called for stub stages");
  },
};

describe("runBrainRun — stages not yet implemented", () => {
  it("returns a stub StageResult per unimplemented stage, in order, without touching the DB", async () => {
    const config: BrainRunConfig = {
      runId: "run-test-stub",
      candidateId: "candidate-1",
      stages: ["preparation", "submission", "inbox", "pipeline", "briefing"],
      maxSubmissions: 1,
      dryRun: true,
    };

    const report = await runBrainRun(config, { db: UNUSED_DB, runner: NEVER_CALLED_RUNNER });

    expect(report.runId).toBe("run-test-stub");
    expect(report.results.map((r) => r.stage)).toEqual([
      "preparation",
      "submission",
      "inbox",
      "pipeline",
      "briefing",
    ]);
    for (const result of report.results) {
      expect(result.ok).toBe(true);
      expect(result.summary).toBe("not yet implemented");
      expect(result.counts).toEqual({});
    }
    expect(report.escalationsCreated).toBe(0);
  });

  it("produces timestamps that bracket the run", async () => {
    const config: BrainRunConfig = {
      runId: "run-test-timestamps",
      candidateId: "candidate-1",
      stages: ["pipeline"],
      maxSubmissions: 1,
      dryRun: true,
    };
    const report = await runBrainRun(config, { db: UNUSED_DB, runner: NEVER_CALLED_RUNNER });
    expect(new Date(report.startedAt).getTime()).toBeLessThanOrEqual(new Date(report.finishedAt).getTime());
  });
});
