import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProvenanceConflictError } from "./errors.js";
import {
  assertHardConstraintRequiresConfirmation,
  assertNoPreferenceProvenanceDowngrade,
  confirmPreference,
  deactivatePreference,
  getActivePreference,
  upsertPreference,
} from "./preferences.js";
import { cleanupTestCandidate, createTestCandidate, db, type TestCandidate } from "./test-db.js";

describe("assertHardConstraintRequiresConfirmation (pure)", () => {
  it("throws when an agent-inferred preference is created as a hard constraint", () => {
    expect(() =>
      assertHardConstraintRequiresConfirmation(
        { strength: "hard_constraint", source: "agent_inferred" },
        {},
      ),
    ).toThrow(ProvenanceConflictError);
  });

  it("allows candidate-confirmed hard constraints", () => {
    expect(() =>
      assertHardConstraintRequiresConfirmation(
        { strength: "hard_constraint", source: "candidate_confirmed" },
        {},
      ),
    ).not.toThrow();
  });

  it("allows agent-inferred preferences at non-hard-constraint strengths", () => {
    for (const strength of ["strong_preference", "preference", "open"] as const) {
      expect(() =>
        assertHardConstraintRequiresConfirmation({ strength, source: "agent_inferred" }, {}),
      ).not.toThrow();
    }
  });
});

describe("assertNoPreferenceProvenanceDowngrade (pure)", () => {
  it("throws when agent-inferred would overwrite a candidate-confirmed preference", () => {
    expect(() =>
      assertNoPreferenceProvenanceDowngrade(
        { source: "candidate_confirmed" },
        { source: "agent_inferred" },
        {},
      ),
    ).toThrow(ProvenanceConflictError);
  });

  it("allows other provenance combinations", () => {
    expect(() =>
      assertNoPreferenceProvenanceDowngrade(undefined, { source: "agent_inferred" }, {}),
    ).not.toThrow();
    expect(() =>
      assertNoPreferenceProvenanceDowngrade(
        { source: "agent_inferred" },
        { source: "agent_inferred" },
        {},
      ),
    ).not.toThrow();
  });
});

describe("preferences CRUD (live DB)", () => {
  let candidate: TestCandidate;

  beforeAll(async () => {
    candidate = await createTestCandidate("preferences");
  });

  afterAll(async () => {
    await cleanupTestCandidate(candidate);
  });

  it("creates then updates the same (candidateId, type) row", async () => {
    await upsertPreference(db, {
      candidateId: candidate.candidateId,
      type: "geography",
      value: { region: "Northeast" },
      strength: "preference",
      source: "agent_inferred",
      actor: "qualification",
    });

    await upsertPreference(db, {
      candidateId: candidate.candidateId,
      type: "geography",
      value: { region: "Southeast" },
      strength: "strong_preference",
      source: "agent_inferred",
      actor: "qualification",
    });

    const pref = await getActivePreference(db, candidate.candidateId, "geography");
    expect(pref?.value).toEqual({ region: "Southeast" });
    expect(pref?.strength).toBe("strong_preference");
  });

  it("rejects an agent-inferred hard_constraint end-to-end", async () => {
    await expect(
      upsertPreference(db, {
        candidateId: candidate.candidateId,
        type: "compensation",
        value: { minimum: 90000 },
        strength: "hard_constraint",
        source: "agent_inferred",
        actor: "strategy",
      }),
    ).rejects.toBeInstanceOf(ProvenanceConflictError);

    const pref = await getActivePreference(db, candidate.candidateId, "compensation");
    expect(pref).toBeUndefined();
  });

  it("allows a candidate-confirmed hard_constraint", async () => {
    const pref = await upsertPreference(db, {
      candidateId: candidate.candidateId,
      type: "compensation",
      value: { minimum: 60000 },
      strength: "hard_constraint",
      source: "candidate_confirmed",
      actor: "candidate",
    });

    expect(pref.strength).toBe("hard_constraint");
    expect(pref.source).toBe("candidate_confirmed");
  });

  it("rejects an agent-inferred write over a candidate-confirmed preference", async () => {
    await expect(
      upsertPreference(db, {
        candidateId: candidate.candidateId,
        type: "compensation",
        value: { minimum: 40000 },
        strength: "preference",
        source: "agent_inferred",
        actor: "qualification",
      }),
    ).rejects.toBeInstanceOf(ProvenanceConflictError);
  });

  it("confirmPreference sets source candidate_confirmed and audits it", async () => {
    await upsertPreference(db, {
      candidateId: candidate.candidateId,
      type: "schedule",
      value: { schedule: "weekdays" },
      strength: "preference",
      source: "agent_inferred",
      actor: "qualification",
    });

    const confirmed = await confirmPreference(db, {
      candidateId: candidate.candidateId,
      type: "schedule",
      actor: "candidate",
    });

    expect(confirmed.source).toBe("candidate_confirmed");
  });

  it("deactivatePreference marks the row inactive and getActivePreference stops returning it", async () => {
    await upsertPreference(db, {
      candidateId: candidate.candidateId,
      type: "industry",
      value: { industry: "logistics" },
      strength: "preference",
      source: "candidate_confirmed",
      actor: "candidate",
    });

    const deactivated = await deactivatePreference(db, {
      candidateId: candidate.candidateId,
      type: "industry",
      actor: "candidate",
      reason: "changed mind",
    });

    expect(deactivated?.active).toBe(false);
    expect(await getActivePreference(db, candidate.candidateId, "industry")).toBeUndefined();
  });

  it("deactivatePreference is a no-op when nothing is active", async () => {
    const result = await deactivatePreference(db, {
      candidateId: candidate.candidateId,
      type: "travel",
      actor: "candidate",
    });
    expect(result).toBeUndefined();
  });
});
