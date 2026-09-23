import { eq } from "drizzle-orm";
import { applicationAnswers } from "@cai/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertFact } from "./facts.js";
import {
  classifyQuestion,
  matchQuestion,
  normalizeQuestion,
  recordAnswerUsage,
  resolveAnswer,
  storeVerifiedAnswer,
} from "./answers.js";
import { cleanupTestCandidate, createTestCandidate, db, type TestCandidate } from "./test-db.js";

describe("normalizeQuestion (pure)", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeQuestion("Are you authorized to work in the U.S.?")).toBe(
      "are you authorized to work in the us",
    );
    expect(normalizeQuestion("  Multiple   spaces   here  ")).toBe("multiple spaces here");
  });
});

describe("matchQuestion (pure)", () => {
  it("matches when normalized strings are equal", () => {
    expect(matchQuestion("phone number", "Phone Number?")).toBe(true);
  });

  it("matches substring in either direction", () => {
    expect(matchQuestion("phone number", "What is your phone number?")).toBe(true);
    expect(matchQuestion("what is your phone number today", "phone number")).toBe(true);
  });

  it("matches via shared significant keywords regardless of order/punctuation", () => {
    expect(
      matchQuestion(
        "are you authorized to work in the us",
        "Are you legally authorized to work in the U.S.?",
      ),
    ).toBe(true);
  });

  it("does not match materially different questions", () => {
    expect(matchQuestion("phone number", "what is your salary expectation")).toBe(false);
    expect(matchQuestion("are you authorized to work", "do you require visa sponsorship")).toBe(
      false,
    );
  });

  it("is false for empty input", () => {
    expect(matchQuestion("", "anything")).toBe(false);
    expect(matchQuestion("anything", "")).toBe(false);
  });
});

describe("classifyQuestion (pure)", () => {
  it("maps well-known question kinds to a (category, key) fact lookup", () => {
    expect(classifyQuestion("Are you authorized to work in the United States?")).toEqual({
      category: "answer",
      key: "work_authorization",
    });
    expect(classifyQuestion("What is the best phone number to reach you?")).toEqual({
      category: "contact",
      key: "phone",
    });
    expect(classifyQuestion("Please provide your email address")).toEqual({
      category: "contact",
      key: "email",
    });
    expect(classifyQuestion("What is your highest level of education?")).toEqual({
      category: "education",
      key: "degree",
    });
  });

  it("returns undefined for a question with no known mapping", () => {
    expect(classifyQuestion("Describe a time you demonstrated leadership.")).toBeUndefined();
  });
});

describe("resolveAnswer (live DB) — strict resolution order, never guess", () => {
  let candidate: TestCandidate;

  beforeAll(async () => {
    candidate = await createTestCandidate("answers");
  });

  afterAll(async () => {
    await cleanupTestCandidate(candidate);
  });

  it("escalates an unknown question with no verified answer, no fact, no derivation", async () => {
    const result = await resolveAnswer(db, {
      candidateId: candidate.candidateId,
      question: "Describe a time you overcame a significant challenge at work.",
    });
    expect(result).toEqual({
      kind: "escalate",
      question: "Describe a time you overcame a significant challenge at work.",
    });
  });

  it("falls back to a candidate fact when no verified answer exists", async () => {
    await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "answer",
      key: "work_authorization",
      value: { question: "Are you authorized to work in the US?", answer: "Yes" },
      sourceType: "candidate_confirmed",
      actor: "candidate",
    });

    const result = await resolveAnswer(db, {
      candidateId: candidate.candidateId,
      question: "Are you authorized to work in the United States?",
    });

    expect(result.kind).toBe("candidate_fact");
    if (result.kind === "candidate_fact") {
      expect(result.value).toEqual({
        question: "Are you authorized to work in the US?",
        answer: "Yes",
      });
    }
  });

  it("prefers a verified stored answer over a candidate fact for the same question", async () => {
    await storeVerifiedAnswer(db, {
      candidateId: candidate.candidateId,
      questionPattern: "are you authorized to work in the united states",
      questionRaw: "Are you authorized to work in the United States?",
      answer: "Yes, U.S. citizen",
      actor: "candidate",
    });

    const result = await resolveAnswer(db, {
      candidateId: candidate.candidateId,
      question: "Are you authorized to work in the United States?",
    });

    expect(result.kind).toBe("verified_answer");
    if (result.kind === "verified_answer") {
      expect(result.value).toBe("Yes, U.S. citizen");
    }
  });

  it("derives years-since-graduation from a dated education fact when nothing else matches", async () => {
    await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "education",
      key: "degree",
      value: { school: "State University", degree: "B.S.", year: 2020 },
      sourceType: "candidate_confirmed",
      actor: "candidate",
    });

    const result = await resolveAnswer(db, {
      candidateId: candidate.candidateId,
      question: "How many years has it been since you graduated?",
    });

    expect(result.kind).toBe("derived");
    if (result.kind === "derived") {
      expect(result.value).toBe(new Date().getFullYear() - 2020);
    }
  });

  it("never guesses: escalates a factual question even when a similarly-shaped fact exists but no mapping covers it", async () => {
    const result = await resolveAnswer(db, {
      candidateId: candidate.candidateId,
      question: "What is your expected start date?",
    });
    expect(result).toEqual({ kind: "escalate", question: "What is your expected start date?" });
  });
});

describe("storeVerifiedAnswer + recordAnswerUsage (live DB)", () => {
  let candidate: TestCandidate;

  beforeAll(async () => {
    candidate = await createTestCandidate("answer-usage");
  });

  afterAll(async () => {
    await cleanupTestCandidate(candidate);
  });

  it("stores a verified answer and bumps lastUsedAt on use", async () => {
    const stored = await storeVerifiedAnswer(db, {
      candidateId: candidate.candidateId,
      questionPattern: "desired salary",
      questionRaw: "What is your desired salary?",
      answer: "$60,000",
      actor: "candidate",
    });

    expect(stored.verified).toBe(true);
    expect(stored.source).toBe("candidate_confirmed");
    expect(stored.lastUsedAt).toBeNull();

    await recordAnswerUsage(db, stored.id);

    const [refetched] = await db
      .select()
      .from(applicationAnswers)
      .where(eq(applicationAnswers.id, stored.id));

    expect(refetched?.lastUsedAt).not.toBeNull();
  });
});
