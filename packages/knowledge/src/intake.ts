/**
 * Baseline profile-completion checklist (PRD FR-1) — drives the dashboard /
 * coach prompts that push the candidate to fill in required knowledge before
 * the agent can safely act on their behalf. Pure read: never writes.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@cai/db";
import { applicationAnswers, candidateFacts, preferences } from "@cai/db";
import { matchQuestion } from "./answers.js";
import type { ApplicationAnswerRow } from "./answers.js";
import type { CandidateFactRow } from "./facts.js";
import type { PreferenceRow } from "./preferences.js";

export type IntakeItemStatus = "missing" | "unverified" | "complete";

export interface IntakeChecklistItem {
  id: string;
  label: string;
  kind: "fact" | "preference" | "answer";
  status: Exclude<IntakeItemStatus, "complete">;
  detail: string;
}

interface RequiredFact {
  id: string;
  label: string;
  category: string;
  key: string;
}

interface RequiredPreference {
  id: string;
  label: string;
  type: string;
}

interface RequiredAnswer {
  id: string;
  label: string;
  questionPattern: string;
}

/** Baseline facts every candidate needs before the agent can apply on their behalf. */
export const REQUIRED_FACTS: RequiredFact[] = [
  { id: "contact.phone", label: "Phone number", category: "contact", key: "phone" },
  { id: "contact.email", label: "Email address", category: "contact", key: "email" },
  {
    id: "answer.work_authorization",
    label: "Work authorization status",
    category: "answer",
    key: "work_authorization",
  },
  { id: "education.degree", label: "Education / degree", category: "education", key: "degree" },
  { id: "employment.history", label: "Employment history", category: "employment", key: "history" },
];

export const REQUIRED_PREFERENCES: RequiredPreference[] = [
  { id: "preference.compensation", label: "Compensation floor", type: "compensation" },
  { id: "preference.geography", label: "Geography / location preference", type: "geography" },
  {
    id: "preference.work_environment",
    label: "Work-environment preference",
    type: "work_environment",
  },
];

/** Standard application answers the agent should have pre-verified before submitting anything. */
export const REQUIRED_ANSWERS: RequiredAnswer[] = [
  {
    id: "answer.standard.work_authorization",
    label: "Standard answer: work authorization",
    questionPattern: "are you authorized to work in this country",
  },
];

// ---------------------------------------------------------------------------
// Pure status evaluators (unit-testable without a DB)
// ---------------------------------------------------------------------------

export function evaluateFactStatus(fact: Pick<CandidateFactRow, "sourceType"> | undefined): IntakeItemStatus {
  if (!fact) return "missing";
  return fact.sourceType === "candidate_confirmed" ? "complete" : "unverified";
}

export function evaluatePreferenceStatus(
  pref: Pick<PreferenceRow, "source" | "active"> | undefined,
): IntakeItemStatus {
  if (!pref || !pref.active) return "missing";
  return pref.source === "candidate_confirmed" ? "complete" : "unverified";
}

export function evaluateAnswerStatus(
  answer: Pick<ApplicationAnswerRow, "verified"> | undefined,
): IntakeItemStatus {
  if (!answer) return "missing";
  return answer.verified ? "complete" : "unverified";
}

/**
 * Pure core of the checklist: given already-fetched rows for a candidate,
 * decide which required items are still incomplete. Exported so most tests
 * can exercise this without touching the database.
 */
export function evaluateChecklist(
  facts: CandidateFactRow[],
  prefs: PreferenceRow[],
  answers: ApplicationAnswerRow[],
): IntakeChecklistItem[] {
  const items: IntakeChecklistItem[] = [];

  for (const req of REQUIRED_FACTS) {
    const fact = facts.find((f) => f.category === req.category && f.key === req.key);
    const status = evaluateFactStatus(fact);
    if (status !== "complete") {
      items.push({
        id: req.id,
        label: req.label,
        kind: "fact",
        status,
        detail: fact ? `on file, source: ${fact.sourceType}` : "no record",
      });
    }
  }

  for (const req of REQUIRED_PREFERENCES) {
    const pref = prefs.find((p) => p.type === req.type && p.active);
    const status = evaluatePreferenceStatus(pref);
    if (status !== "complete") {
      items.push({
        id: req.id,
        label: req.label,
        kind: "preference",
        status,
        detail: pref ? `on file, source: ${pref.source}` : "no record",
      });
    }
  }

  for (const req of REQUIRED_ANSWERS) {
    const answer = answers.find(
      (a) => matchQuestion(req.questionPattern, a.questionRaw ?? a.questionPattern),
    );
    const status = evaluateAnswerStatus(answer);
    if (status !== "complete") {
      items.push({
        id: req.id,
        label: req.label,
        kind: "answer",
        status,
        detail: answer ? "stored but not verified" : "no record",
      });
    }
  }

  return items;
}

/** Fetches the candidate's current facts/preferences/answers and evaluates the checklist. */
export async function buildIntakeChecklist(db: Db, candidateId: string): Promise<IntakeChecklistItem[]> {
  const [facts, prefs, answers] = await Promise.all([
    db.select().from(candidateFacts).where(eq(candidateFacts.candidateId, candidateId)),
    db.select().from(preferences).where(eq(preferences.candidateId, candidateId)),
    db.select().from(applicationAnswers).where(eq(applicationAnswers.candidateId, candidateId)),
  ]);

  return evaluateChecklist(facts, prefs, answers);
}
