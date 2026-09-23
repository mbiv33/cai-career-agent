/**
 * Application-answer memory (spec §10). This module is the deterministic
 * home of `AnswerResolution` (@cai/core): it NEVER calls an LLM and NEVER
 * guesses. Resolution order, strictly:
 *
 *   1. verified stored answer  (application_answers, verified = true)
 *   2. candidate facts         (candidate_facts, via a small keyword map)
 *   3. authorized deterministic derivation (minimal — e.g. years since a
 *      dated fact)
 *   4. escalate
 *
 * The LLM-assisted drafting path (turning a fresh question into a candidate
 * answer) lives elsewhere; it only ever writes back here, via
 * `storeVerifiedAnswer`, after the candidate has confirmed the value.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@cai/db";
import { applicationAnswers } from "@cai/db";
import { recordAudit } from "@cai/core";
import type { AnswerResolution, AuthorityLevel } from "@cai/core";
import { getFact } from "./facts.js";
import type { Provenance } from "./facts.js";

export type ApplicationAnswerRow = typeof applicationAnswers.$inferSelect;

// ---------------------------------------------------------------------------
// Question normalization + matching (pure, no DB)
// ---------------------------------------------------------------------------

/** lowercase, strip punctuation, collapse whitespace. */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens ignored when doing keyword matching — too common to be discriminating. */
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "you", "your", "do", "does", "did",
  "to", "for", "of", "in", "on", "at", "and", "or", "please", "will",
  "have", "has", "had", "this", "that", "if", "any", "can", "i", "my",
]);

function significantTokens(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/**
 * True when `pattern` (a stored `questionPattern`) should be treated as
 * describing `question` (a raw question pulled off an application form).
 * Deterministic, keyword/substring based — never fuzzy in a way that could
 * misfire on a materially different question.
 */
export function matchQuestion(pattern: string, question: string): boolean {
  const normPattern = normalizeQuestion(pattern);
  const normQuestion = normalizeQuestion(question);
  if (!normPattern || !normQuestion) return false;

  if (normQuestion.includes(normPattern) || normPattern.includes(normQuestion)) {
    return true;
  }

  const patternTokens = significantTokens(normPattern);
  if (patternTokens.length === 0) return false;

  const questionTokens = new Set(significantTokens(normQuestion));
  return patternTokens.every((t) => questionTokens.has(t));
}

// ---------------------------------------------------------------------------
// Step (b): candidate-facts lookup for well-known question kinds
// ---------------------------------------------------------------------------

interface FactLookupTarget {
  category: string;
  key: string;
}

interface KeywordMapEntry {
  keywords: string[];
  target: FactLookupTarget;
}

/** Minimal, deliberately small — extend as well-known question kinds emerge. */
const QUESTION_KEYWORD_MAP: KeywordMapEntry[] = [
  {
    keywords: ["authorized to work", "work authorization", "legally authorized to work", "eligible to work"],
    target: { category: "answer", key: "work_authorization" },
  },
  {
    keywords: ["require sponsorship", "sponsorship", "visa sponsorship", "need sponsorship"],
    target: { category: "answer", key: "sponsorship_required" },
  },
  {
    keywords: ["phone number", "telephone number", "contact number", "best phone"],
    target: { category: "contact", key: "phone" },
  },
  {
    keywords: ["email address", "your email"],
    target: { category: "contact", key: "email" },
  },
  {
    keywords: ["highest level of education", "highest degree", "education level", "degree"],
    target: { category: "education", key: "degree" },
  },
  {
    keywords: ["current employer", "most recent employer", "current company"],
    target: { category: "employment", key: "most_recent" },
  },
];

/** Pure — maps a raw question to a (category, key) fact lookup, or undefined. */
export function classifyQuestion(question: string): FactLookupTarget | undefined {
  const norm = normalizeQuestion(question);
  for (const entry of QUESTION_KEYWORD_MAP) {
    if (entry.keywords.some((kw) => norm.includes(normalizeQuestion(kw)))) {
      return entry.target;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Step (c): authorized deterministic derivation — kept intentionally minimal
// ---------------------------------------------------------------------------

const YEARS_SINCE_GRADUATION_RE = /(years?.*(since|ago).*graduat)|(graduat.*years?)/;

/**
 * The only derivation this package performs today: "years since graduation",
 * computed from the candidate's stored education fact. Anything else falls
 * through to escalation rather than being guessed at.
 */
async function tryDerive(
  db: Db,
  candidateId: string,
  question: string,
): Promise<AnswerResolution | undefined> {
  const norm = normalizeQuestion(question);
  if (!YEARS_SINCE_GRADUATION_RE.test(norm)) return undefined;

  const educationFact = await getFact(db, candidateId, "education", "degree");
  const value = educationFact?.value as { year?: number } | undefined;
  if (!value || typeof value.year !== "number") return undefined;

  const currentYear = new Date().getFullYear();
  const years = currentYear - value.year;

  return {
    kind: "derived",
    value: years,
    derivation: `current_year(${currentYear}) - education.degree.year(${value.year})`,
  };
}

// ---------------------------------------------------------------------------
// resolveAnswer — the strict resolution order
// ---------------------------------------------------------------------------

export interface ResolveAnswerInput {
  candidateId: string;
  question: string;
}

export async function resolveAnswer(db: Db, input: ResolveAnswerInput): Promise<AnswerResolution> {
  // (a) verified stored answer
  const verifiedRows = await db
    .select()
    .from(applicationAnswers)
    .where(
      and(eq(applicationAnswers.candidateId, input.candidateId), eq(applicationAnswers.verified, true)),
    );
  const matched = verifiedRows.find((row) => matchQuestion(row.questionPattern, input.question));
  if (matched) {
    return { kind: "verified_answer", answerId: matched.id, value: matched.answer };
  }

  // (b) candidate facts, for well-known question kinds
  const target = classifyQuestion(input.question);
  if (target) {
    const fact = await getFact(db, input.candidateId, target.category, target.key);
    if (fact) {
      return { kind: "candidate_fact", factId: fact.id, value: fact.value };
    }
  }

  // (c) authorized deterministic derivation — minimal, never a guess
  const derived = await tryDerive(db, input.candidateId, input.question);
  if (derived) {
    return derived;
  }

  // (d) never guess — escalate
  return { kind: "escalate", question: input.question };
}

// ---------------------------------------------------------------------------
// Writing back verified answers + usage tracking
// ---------------------------------------------------------------------------

export interface StoreVerifiedAnswerInput {
  candidateId: string;
  applicationId?: string;
  questionPattern: string;
  questionRaw?: string;
  answer: unknown;
  actor: string;
  /** Defaults to AUTO: a verified, candidate-confirmed answer needs no further gate to reuse. */
  authorityLevel?: AuthorityLevel;
  /** Defaults to "candidate_confirmed" — the only source that may set verified = true. */
  source?: Extract<Provenance, "candidate_confirmed" | "outcome_learned">;
}

export async function storeVerifiedAnswer(
  db: Db,
  input: StoreVerifiedAnswerInput,
): Promise<ApplicationAnswerRow> {
  const [row] = await db
    .insert(applicationAnswers)
    .values({
      candidateId: input.candidateId,
      applicationId: input.applicationId,
      questionPattern: input.questionPattern,
      questionRaw: input.questionRaw,
      answer: input.answer,
      source: input.source ?? "candidate_confirmed",
      verified: true,
      authorityLevel: input.authorityLevel ?? "AUTO",
    })
    .returning();

  await recordAudit(db, {
    actor: input.actor,
    eventType: "answer.verified",
    entityType: "application_answer",
    entityId: row!.id,
    action: `Stored verified answer for "${input.questionPattern}"`,
    evidence: { answer: input.answer },
  });

  return row!;
}

/** Usage tracking only — deliberately not audited (would flood audit_events on every reuse). */
export async function recordAnswerUsage(db: Db, answerId: string): Promise<void> {
  await db
    .update(applicationAnswers)
    .set({ lastUsedAt: new Date() })
    .where(eq(applicationAnswers.id, answerId));
}
