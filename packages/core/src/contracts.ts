/**
 * Typed contracts between the scheduler, the brain run, and per-agent stages.
 * Parallel tracks code against these shapes; changing them requires a
 * main-branch PR first (see CLAUDE.md).
 *
 * A "brain run" is one scheduled batch execution (3–4×/day on the Mac):
 *   discovery → qualification → preparation/submission → inbox → pipeline → briefing
 */

export type AgentName =
  | "discovery"
  | "qualification"
  | "research"
  | "application"
  | "communication"
  | "pipeline"
  | "coaching"
  | "strategy"
  | "manager";

export type RunStage =
  | "discovery"
  | "qualification"
  | "preparation"
  | "submission"
  | "inbox"
  | "pipeline"
  | "briefing";

export interface BrainRunConfig {
  runId: string; // e.g. "run-2026-09-23T09-00"
  candidateId: string;
  stages: RunStage[];
  /** Cap on new applications this run may submit (safety valve). */
  maxSubmissions: number;
  dryRun: boolean;
}

export interface StageResult {
  stage: RunStage;
  ok: boolean;
  summary: string;
  counts: Record<string, number>; // e.g. { discovered: 12, deduped: 3 }
  tokenUsage?: TokenUsage;
  error?: string;
}

export interface BrainRunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  results: StageResult[];
  escalationsCreated: number;
}

/** Per-call token accounting — written to agent_actions.detail for cost visibility. */
export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  /** USD, 0 when the backend is subscription-covered Claude Code. */
  estimatedCostUsd: number;
}

/** Discovery stage output: raw postings to normalize. */
export interface DiscoveredPosting {
  source: string;
  sourceUrl?: string;
  externalJobId?: string;
  rawContent: unknown;
}

/** Answer-resolution result (spec §10 resolution order). */
export type AnswerResolution =
  | { kind: "verified_answer"; answerId: string; value: unknown }
  | { kind: "candidate_fact"; factId: string; value: unknown }
  | { kind: "derived"; value: unknown; derivation: string }
  | { kind: "escalate"; question: string };
