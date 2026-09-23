/**
 * Per-call token accounting. Every model call in a brain run is recorded as an
 * agent_action so actual usage/cost is inspectable in the dashboard from day
 * one — whichever backend is active.
 */
import type { Db } from "@cai/db";
import { agentActions } from "@cai/db";
import type { AgentName, TokenUsage } from "@cai/core";
import type { AgentTask } from "./tiers.js";

export async function logModelCall(
  db: Db,
  params: {
    agent: AgentName;
    task: AgentTask;
    runId?: string;
    usage: TokenUsage;
    summary: string;
  },
): Promise<void> {
  await db.insert(agentActions).values({
    agent: params.agent,
    actionType: `model_call:${params.task}`,
    authority: "AUTO",
    summary: params.summary,
    detail: { usage: params.usage },
    runId: params.runId,
  });
}
