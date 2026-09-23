/**
 * Brain run CLI — the launchd entrypoint on the Mac (CLAUDE.md architecture),
 * run locally via `pnpm --filter worker brain -- [flags]`.
 *
 *   --dry-run                 evaluate everything, write nothing to the DB
 *   --stages a,b,c             comma-separated RunStage list (default: all)
 *   --max-submissions N        cap on new applications this run may submit
 *
 * AGENT_RUNNER=fake selects the worker-local FakeRunner (zero-cost, for
 * smoke tests) instead of the @cai/agents claude-code/api backends.
 */
import { pathToFileURL } from "node:url";
import { candidateProfiles, createDb } from "@cai/db";
import { createRunner } from "@cai/agents";
import type { BrainRunConfig, RunStage } from "@cai/core";
import { runBrainRun } from "./brain-run.js";
import { FakeRunner } from "./fake-runner.js";

const ALL_STAGES: RunStage[] = [
  "discovery",
  "qualification",
  "preparation",
  "submission",
  "inbox",
  "pipeline",
  "briefing",
];

interface CliArgs {
  dryRun: boolean;
  stages: RunStage[];
  maxSubmissions: number;
}

export function parseArgs(argv: string[]): CliArgs {
  let dryRun = false;
  let stages: RunStage[] = ALL_STAGES;
  let maxSubmissions = 5;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--stages") {
      const value = argv[++i];
      if (!value) throw new Error("--stages requires a comma-separated value");
      stages = value.split(",").map((s) => s.trim()) as RunStage[];
    } else if (arg === "--max-submissions") {
      const value = argv[++i];
      if (!value) throw new Error("--max-submissions requires a number");
      maxSubmissions = Number(value);
      if (!Number.isFinite(maxSubmissions)) throw new Error("--max-submissions must be a number");
    }
  }

  return { dryRun, stages, maxSubmissions };
}

export function makeRunId(now: Date = new Date()): string {
  return `run-${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = createDb();

  const [candidate] = await db.select().from(candidateProfiles).limit(1);
  if (!candidate) {
    throw new Error("No candidate_profiles row found — run `pnpm db:seed` first.");
  }

  const runner = process.env.AGENT_RUNNER === "fake" ? new FakeRunner() : createRunner();

  const config: BrainRunConfig = {
    runId: makeRunId(),
    candidateId: candidate.id,
    stages: args.stages,
    maxSubmissions: args.maxSubmissions,
    dryRun: args.dryRun,
  };

  console.log(
    `Brain run ${config.runId} — stages: ${config.stages.join(", ")}${config.dryRun ? " (dry run)" : ""}`,
  );

  const report = await runBrainRun(config, { db, runner });

  console.log(`\n=== Brain run report: ${report.runId} ===`);
  console.log(`Started:  ${report.startedAt}`);
  console.log(`Finished: ${report.finishedAt}`);
  for (const result of report.results) {
    console.log(`\n[${result.stage}] ${result.ok ? "OK" : "FAILED"} — ${result.summary}`);
    for (const [key, value] of Object.entries(result.counts)) {
      console.log(`    ${key}: ${value}`);
    }
    if (result.error) console.log(`    error: ${result.error}`);
  }
  console.log(`\nEscalations created: ${report.escalationsCreated}`);

  process.exit(report.results.every((r) => r.ok) ? 0 : 1);
}

// Only run when executed directly (`tsx src/cli.ts`) — not when imported by
// tests, so `parseArgs`/`makeRunId` are unit-testable without touching the DB.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
