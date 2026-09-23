/**
 * Opportunity state machine (spec §8). Every transition must go through
 * `assertTransition` and generate an audit event — direct status writes are a
 * code-review rejection.
 */

export const JOB_STATUSES = [
  "DISCOVERED",
  "NORMALIZED",
  "QUALIFYING",
  "REJECTED",
  "QUALIFIED",
  "RESEARCHED",
  "PREPARING",
  "READY",
  "APPLYING",
  "ESCALATED",
  "SUBMITTED",
  "MONITORING",
  "EMPLOYER_RESPONSE",
  "INTERVIEW",
  "OFFER",
  "CLOSED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  DISCOVERED: ["NORMALIZED"],
  NORMALIZED: ["QUALIFYING"],
  QUALIFYING: ["REJECTED", "QUALIFIED"],
  REJECTED: [], // retained, never deleted; terminal for the agent
  QUALIFIED: ["RESEARCHED", "CLOSED"],
  RESEARCHED: ["PREPARING", "CLOSED"],
  PREPARING: ["READY", "CLOSED"],
  READY: ["APPLYING", "CLOSED"],
  APPLYING: ["ESCALATED", "SUBMITTED", "CLOSED"],
  ESCALATED: ["APPLYING", "CLOSED"], // resume after HITL resolution
  SUBMITTED: ["MONITORING"],
  MONITORING: ["EMPLOYER_RESPONSE", "CLOSED"],
  EMPLOYER_RESPONSE: ["INTERVIEW", "CLOSED"],
  INTERVIEW: ["OFFER", "EMPLOYER_RESPONSE", "CLOSED"],
  OFFER: ["CLOSED"],
  CLOSED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: JobStatus,
    public readonly to: JobStatus,
  ) {
    super(`Invalid job transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** States that appear in the candidate-facing Pipeline screen (PRD §5.4). */
export const PIPELINE_STAGES: Record<string, readonly JobStatus[]> = {
  Discovered: ["DISCOVERED", "NORMALIZED", "QUALIFYING"],
  Qualified: ["QUALIFIED", "RESEARCHED"],
  Prepared: ["PREPARING", "READY"],
  Applied: ["APPLYING", "ESCALATED", "SUBMITTED"],
  "Employer Response": ["MONITORING", "EMPLOYER_RESPONSE"],
  Interview: ["INTERVIEW"],
  Offer: ["OFFER"],
  Closed: ["CLOSED"],
  "Rejected by Agent": ["REJECTED"],
};
