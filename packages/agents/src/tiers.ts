/**
 * Model tiering — the cost-efficiency contract for every model call.
 * Haiku for high-volume mechanical work, Sonnet for judgment, Opus only for
 * strategy. Applies identically on both backends; on the claude-code backend
 * the tier maps to a CLI model alias, on the API backend to a model ID.
 */

export type ModelTier = "haiku" | "sonnet" | "opus";

export type AgentTask =
  | "normalize_posting"
  | "dedupe_postings"
  | "classify_email"
  | "qualify_job"
  | "research_employer"
  | "tailor_resume"
  | "generate_cover_letter"
  | "resolve_answer"
  | "map_form_fields"
  | "draft_reply"
  | "coach_chat"
  | "daily_briefing"
  | "strategy_analysis";

export const TASK_TIERS: Record<AgentTask, ModelTier> = {
  normalize_posting: "haiku",
  dedupe_postings: "haiku",
  classify_email: "haiku",
  qualify_job: "sonnet",
  research_employer: "sonnet",
  tailor_resume: "sonnet",
  generate_cover_letter: "sonnet",
  resolve_answer: "sonnet",
  map_form_fields: "sonnet",
  draft_reply: "sonnet",
  coach_chat: "sonnet",
  daily_briefing: "sonnet",
  strategy_analysis: "opus",
};

export const API_MODEL_IDS: Record<ModelTier, string> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
};

/** USD per million tokens (input, output) — for cost logging only. */
export const PRICING_PER_MTOK: Record<ModelTier, { input: number; output: number }> = {
  haiku: { input: 1, output: 5 },
  sonnet: { input: 2, output: 10 },
  opus: { input: 5, output: 25 },
};

export function estimateCostUsd(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const p = PRICING_PER_MTOK[tier];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
