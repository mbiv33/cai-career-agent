/**
 * Deterministic, zero-cost ModelRunner for local smoke runs and CI —
 * selected via AGENT_RUNNER=fake in cli.ts (worker-only; the "fake" backend
 * is intentionally NOT added to @cai/agents createRunner(), which stays
 * claude-code | api per the runner contract).
 */
import type { ModelRequest, ModelResponse, ModelRunner } from "@cai/agents";

function jobWorkEnvironmentFromPrompt(prompt: string): string | undefined {
  try {
    const parsed = JSON.parse(prompt) as { job?: { workEnvironment?: string } };
    return parsed.job?.workEnvironment;
  } catch {
    return undefined;
  }
}

export class FakeRunner implements ModelRunner {
  async run(req: ModelRequest): Promise<ModelResponse> {
    if (req.task === "normalize_posting") {
      return {
        text: JSON.stringify({
          compensationMin: 54000,
          compensationMax: 60000,
          employmentType: "full_time",
          schedule: "day_shift",
          travel: "local",
          workEnvironment: "field",
          responsibilities: ["Support field operations as described in the posting."],
          minimumRequirements: ["See posting."],
          preferredRequirements: [],
          physicalRequirements: [],
          careerPath: "Field associate -> team lead",
        }),
        usage: { model: "fake:normalize_posting", inputTokens: 120, outputTokens: 60, estimatedCostUsd: 0 },
      };
    }

    if (req.task === "qualify_job") {
      const desk = jobWorkEnvironmentFromPrompt(req.prompt) === "desk";
      return {
        text: JSON.stringify({
          decision: desk ? "rejected" : "qualified",
          reasoning: desk
            ? "Predominantly desk-based; conflicts with the candidate's confirmed field-work preference."
            : "Field-based role within compensation range; advances the candidate's operations career path.",
          careerFit: desk
            ? "Neutral to negative — does not build toward the field-operations goal."
            : "Advances the stated field-operations career direction.",
          preferenceFit: desk ? "Conflict: desk-based work environment." : "Match: active field work.",
        }),
        usage: { model: "fake:qualify_job", inputTokens: 220, outputTokens: 90, estimatedCostUsd: 0 },
      };
    }

    return {
      text: JSON.stringify({}),
      usage: { model: "fake:unhandled_task", inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    };
  }
}
