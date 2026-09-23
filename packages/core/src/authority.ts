/**
 * Authority model (PRD §8). Every action type an agent can take is mapped to an
 * authorization level. Permissions are configurable per candidate — these are
 * the defaults; overrides live in the database (candidate "Agent permissions"
 * on the Career screen) and are merged over the defaults at run time.
 */

export const AUTHORITY_LEVELS = [
  "AUTO",
  "AUTO_REPORT",
  "ASK_BEFORE_ACTION",
  "HUMAN_REQUIRED",
  "PROHIBITED",
] as const;

export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];

export type ActionType =
  | "job.reject_mismatch"
  | "job.qualify"
  | "resume.tailor"
  | "cover_letter.generate"
  | "application.submit_within_policy"
  | "application.answer_from_verified"
  | "application.answer_legal_disclosure"
  | "application.complete_assessment"
  | "communication.routine_followup"
  | "communication.send_substantive"
  | "communication.send_thank_you"
  | "calendar.propose_times"
  | "calendar.create_event"
  | "strategy.change_salary_floor"
  | "strategy.change_career_direction"
  | "strategy.update_policy"
  | "facts.invent_information";

/** PRD §8 example defaults, extended to cover every ActionType. */
export const DEFAULT_POLICIES: Record<ActionType, AuthorityLevel> = {
  "job.reject_mismatch": "AUTO_REPORT",
  "job.qualify": "AUTO_REPORT",
  "resume.tailor": "AUTO",
  "cover_letter.generate": "AUTO",
  "application.submit_within_policy": "AUTO_REPORT",
  "application.answer_from_verified": "AUTO",
  "application.answer_legal_disclosure": "HUMAN_REQUIRED",
  "application.complete_assessment": "HUMAN_REQUIRED",
  "communication.routine_followup": "AUTO_REPORT",
  "communication.send_substantive": "ASK_BEFORE_ACTION",
  "communication.send_thank_you": "AUTO_REPORT",
  "calendar.propose_times": "AUTO_REPORT",
  "calendar.create_event": "ASK_BEFORE_ACTION",
  "strategy.change_salary_floor": "ASK_BEFORE_ACTION",
  "strategy.change_career_direction": "ASK_BEFORE_ACTION",
  "strategy.update_policy": "ASK_BEFORE_ACTION",
  "facts.invent_information": "PROHIBITED",
};

export type AuthorityDecision =
  | { allowed: true; level: "AUTO"; report: false }
  | { allowed: true; level: "AUTO_REPORT"; report: true }
  | { allowed: false; level: "ASK_BEFORE_ACTION" | "HUMAN_REQUIRED"; escalate: true }
  | { allowed: false; level: "PROHIBITED"; escalate: false };

/**
 * Decide whether an agent may perform an action. Never throws: PROHIBITED and
 * escalation-requiring levels come back as structured decisions so callers
 * must handle them explicitly.
 */
export function checkAuthority(
  action: ActionType,
  overrides: Partial<Record<ActionType, AuthorityLevel>> = {},
): AuthorityDecision {
  const level = overrides[action] ?? DEFAULT_POLICIES[action];
  switch (level) {
    case "AUTO":
      return { allowed: true, level, report: false };
    case "AUTO_REPORT":
      return { allowed: true, level, report: true };
    case "ASK_BEFORE_ACTION":
    case "HUMAN_REQUIRED":
      return { allowed: false, level, escalate: true };
    case "PROHIBITED":
      return { allowed: false, level, escalate: false };
  }
}
