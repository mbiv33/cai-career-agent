import { describe, expect, it } from "vitest";
import {
  JOB_STATUSES,
  PIPELINE_STAGES,
  assertTransition,
  canTransition,
  InvalidTransitionError,
} from "./state-machine.js";

describe("job state machine", () => {
  it("follows the happy path from discovery to offer", () => {
    const path = [
      "DISCOVERED",
      "NORMALIZED",
      "QUALIFYING",
      "QUALIFIED",
      "RESEARCHED",
      "PREPARING",
      "READY",
      "APPLYING",
      "SUBMITTED",
      "MONITORING",
      "EMPLOYER_RESPONSE",
      "INTERVIEW",
      "OFFER",
      "CLOSED",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("allows qualification to reject, and rejection is terminal", () => {
    expect(canTransition("QUALIFYING", "REJECTED")).toBe(true);
    for (const to of JOB_STATUSES) {
      expect(canTransition("REJECTED", to)).toBe(false);
    }
  });

  it("supports HITL interrupt and resume during application", () => {
    expect(canTransition("APPLYING", "ESCALATED")).toBe(true);
    expect(canTransition("ESCALATED", "APPLYING")).toBe(true);
  });

  it("rejects skipping qualification", () => {
    expect(canTransition("DISCOVERED", "APPLYING")).toBe(false);
    expect(() => assertTransition("DISCOVERED", "SUBMITTED")).toThrow(InvalidTransitionError);
  });

  it("maps every status to exactly one pipeline stage", () => {
    for (const status of JOB_STATUSES) {
      const stages = Object.values(PIPELINE_STAGES).filter((s) => s.includes(status));
      expect(stages).toHaveLength(1);
    }
  });
});
