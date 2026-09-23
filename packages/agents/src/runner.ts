/**
 * The single interface every agent uses to call a model. Two backends:
 *
 *  - "claude-code": shells out to the Claude Code CLI in headless mode
 *    (`claude -p`). Covered by the subscription — $0 marginal cost. Default
 *    on the Mac for brain runs and the coach relay listener.
 *
 *  - "api": Anthropic API via fetch. Used only by the Vercel coach fallback
 *    (asleep-Mac case) against the $20 prepaid hard cap.
 *
 * AGENT_RUNNER env var selects the backend; agents never know which is active.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TokenUsage } from "@cai/core";
import { API_MODEL_IDS, estimateCostUsd, TASK_TIERS, type AgentTask } from "./tiers.js";

const execFileAsync = promisify(execFile);

export interface ModelRequest {
  task: AgentTask;
  system?: string;
  prompt: string;
  maxTokens?: number;
}

export interface ModelResponse {
  text: string;
  usage: TokenUsage;
}

export interface ModelRunner {
  run(req: ModelRequest): Promise<ModelResponse>;
}

/** Headless Claude Code backend (subscription-covered). */
export class ClaudeCodeRunner implements ModelRunner {
  constructor(private readonly claudeBin = process.env.CLAUDE_BIN ?? "claude") {}

  async run(req: ModelRequest): Promise<ModelResponse> {
    const tier = TASK_TIERS[req.task];
    const args = [
      "-p",
      req.prompt,
      "--model",
      tier,
      "--output-format",
      "json",
      "--max-turns",
      "1",
    ];
    if (req.system) args.push("--append-system-prompt", req.system);

    const { stdout } = await execFileAsync(this.claudeBin, args, {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    });
    const parsed = JSON.parse(stdout) as {
      result?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      text: parsed.result ?? "",
      usage: {
        model: `claude-code:${tier}`,
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
        estimatedCostUsd: 0, // subscription-covered
      },
    };
  }
}

/** Anthropic API backend (prepaid credits — the coach's asleep-Mac fallback). */
export class ApiRunner implements ModelRunner {
  constructor(private readonly apiKey = process.env.ANTHROPIC_API_KEY) {}

  async run(req: ModelRequest): Promise<ModelResponse> {
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is not set for AGENT_RUNNER=api");
    const tier = TASK_TIERS[req.task];
    const model = API_MODEL_IDS[tier];

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 4096,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
    };
    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return {
      text,
      usage: {
        model,
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        cacheReadTokens: data.usage.cache_read_input_tokens,
        estimatedCostUsd: estimateCostUsd(tier, data.usage.input_tokens, data.usage.output_tokens),
      },
    };
  }
}

export function createRunner(backend = process.env.AGENT_RUNNER ?? "claude-code"): ModelRunner {
  switch (backend) {
    case "claude-code":
      return new ClaudeCodeRunner();
    case "api":
      return new ApiRunner();
    default:
      throw new Error(`Unknown AGENT_RUNNER backend: ${backend}`);
  }
}
