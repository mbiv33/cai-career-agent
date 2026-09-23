/**
 * Brain run orchestrator — executes the run stages sequentially (spec §8,
 * CLAUDE.md batch cadence) and returns one report per run. Stage 1 (Track A)
 * implements discovery + qualification; every other stage is a stub until
 * its track lands, per the DoD in this track's spec.
 */
import type { Db } from "@cai/db";
import {
  recordAudit,
  type BrainRunConfig,
  type BrainRunReport,
  type RunStage,
  type StageResult,
} from "@cai/core";
import { runDiscoveryStage, runQualificationStage, type JobSourceProvider, type ModelRunner } from "@cai/agents";

export interface RunBrainRunDeps {
  db: Db;
  runner: ModelRunner;
  /** Defaults to FixtureSourceProvider inside runDiscoveryStage when omitted. */
  provider?: JobSourceProvider;
}

const IMPLEMENTED_STAGES: ReadonlySet<RunStage> = new Set(["discovery", "qualification"]);

function stubResult(stage: RunStage): StageResult {
  return { stage, ok: true, summary: "not yet implemented", counts: {} };
}

export async function runBrainRun(config: BrainRunConfig, deps: RunBrainRunDeps): Promise<BrainRunReport> {
  const startedAt = new Date().toISOString();
  const results: StageResult[] = [];

  for (const stage of config.stages) {
    if (!IMPLEMENTED_STAGES.has(stage)) {
      results.push(stubResult(stage));
      continue;
    }

    try {
      if (stage === "discovery") {
        results.push(
          await runDiscoveryStage({
            db: deps.db,
            runner: deps.runner,
            candidateId: config.candidateId,
            runId: config.runId,
            dryRun: config.dryRun,
            provider: deps.provider,
          }),
        );
      } else {
        // stage === "qualification"
        results.push(
          await runQualificationStage({
            db: deps.db,
            runner: deps.runner,
            candidateId: config.candidateId,
            runId: config.runId,
            dryRun: config.dryRun,
          }),
        );
      }
    } catch (err) {
      results.push({
        stage,
        ok: false,
        summary: `Stage failed: ${(err as Error).message}`,
        counts: {},
        error: (err as Error).stack ?? String(err),
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const escalationsCreated = results.reduce((sum, r) => sum + (r.counts.escalationsCreated ?? 0), 0);

  if (!config.dryRun) {
    await recordAudit(deps.db, {
      actor: "manager",
      eventType: "brain_run.completed",
      entityType: "brain_run",
      action: `Brain run ${config.runId} finished: ${results.map((r) => `${r.stage}=${r.ok ? "ok" : "failed"}`).join(", ")}`,
      evidence: { runId: config.runId, results },
    });
  }

  return { runId: config.runId, startedAt, finishedAt, results, escalationsCreated };
}
