import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProvenanceConflictError } from "./errors.js";
import {
  assertNoProvenanceDowngrade,
  confirmFact,
  getFact,
  getFacts,
  upsertFact,
} from "./facts.js";
import { cleanupTestCandidate, createTestCandidate, db, type TestCandidate } from "./test-db.js";

describe("assertNoProvenanceDowngrade (pure)", () => {
  it("throws when an agent-inferred write would overwrite a candidate-confirmed fact", () => {
    expect(() =>
      assertNoProvenanceDowngrade(
        { sourceType: "candidate_confirmed" },
        { sourceType: "agent_inferred" },
        {},
      ),
    ).toThrow(ProvenanceConflictError);
  });

  it("allows agent-inferred writes over agent-inferred, outcome-learned, or missing facts", () => {
    expect(() =>
      assertNoProvenanceDowngrade({ sourceType: "agent_inferred" }, { sourceType: "agent_inferred" }, {}),
    ).not.toThrow();
    expect(() =>
      assertNoProvenanceDowngrade({ sourceType: "outcome_learned" }, { sourceType: "agent_inferred" }, {}),
    ).not.toThrow();
    expect(() =>
      assertNoProvenanceDowngrade(undefined, { sourceType: "agent_inferred" }, {}),
    ).not.toThrow();
  });

  it("allows candidate-confirmed writes to overwrite candidate-confirmed facts", () => {
    expect(() =>
      assertNoProvenanceDowngrade(
        { sourceType: "candidate_confirmed" },
        { sourceType: "candidate_confirmed" },
        {},
      ),
    ).not.toThrow();
  });
});

describe("facts CRUD (live DB)", () => {
  let candidate: TestCandidate;

  beforeAll(async () => {
    candidate = await createTestCandidate("facts");
  });

  afterAll(async () => {
    await cleanupTestCandidate(candidate);
  });

  it("creates a fact and audits it", async () => {
    const fact = await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "contact",
      key: "phone",
      value: { number: "555-0100" },
      sourceType: "candidate_confirmed",
      actor: "candidate",
    });

    expect(fact.category).toBe("contact");
    expect(fact.sourceType).toBe("candidate_confirmed");

    const fetched = await getFact(db, candidate.candidateId, "contact", "phone");
    expect(fetched?.value).toEqual({ number: "555-0100" });
  });

  it("updates the same (category, key) row instead of duplicating it", async () => {
    await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "contact",
      key: "email",
      value: { address: "old@example.com" },
      sourceType: "agent_inferred",
      actor: "discovery",
    });

    await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "contact",
      key: "email",
      value: { address: "new@example.com" },
      sourceType: "agent_inferred",
      actor: "discovery",
    });

    const rows = await getFacts(db, candidate.candidateId, "contact");
    const emailRows = rows.filter((r) => r.key === "email");
    expect(emailRows).toHaveLength(1);
    expect(emailRows[0]?.value).toEqual({ address: "new@example.com" });
  });

  it("throws ProvenanceConflictError end-to-end when agent-inferred tries to overwrite candidate-confirmed", async () => {
    await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "education",
      key: "degree",
      value: { school: "State University", year: 2020 },
      sourceType: "candidate_confirmed",
      actor: "candidate",
    });

    await expect(
      upsertFact(db, {
        candidateId: candidate.candidateId,
        category: "education",
        key: "degree",
        value: { school: "Somewhere Else", year: 1999 },
        sourceType: "agent_inferred",
        actor: "research",
      }),
    ).rejects.toBeInstanceOf(ProvenanceConflictError);

    // The candidate-confirmed value must be untouched.
    const fact = await getFact(db, candidate.candidateId, "education", "degree");
    expect(fact?.value).toEqual({ school: "State University", year: 2020 });
    expect(fact?.sourceType).toBe("candidate_confirmed");
  });

  it("confirmFact marks a fact candidate_confirmed, stamps verifiedAt, and audits it", async () => {
    await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "skill",
      key: "forklift_certified",
      value: { certified: true },
      sourceType: "agent_inferred",
      actor: "research",
    });

    const confirmed = await confirmFact(db, {
      candidateId: candidate.candidateId,
      category: "skill",
      key: "forklift_certified",
      actor: "candidate",
    });

    expect(confirmed.sourceType).toBe("candidate_confirmed");
    expect(confirmed.verifiedAt).not.toBeNull();
  });

  it("confirmFact throws for a fact that does not exist", async () => {
    await expect(
      confirmFact(db, {
        candidateId: candidate.candidateId,
        category: "skill",
        key: "does_not_exist",
        actor: "candidate",
      }),
    ).rejects.toThrow();
  });
});
