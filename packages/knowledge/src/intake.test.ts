import { eq } from "drizzle-orm";
import { candidateProfiles, users } from "@cai/db";
import { describe, expect, it } from "vitest";
import type { ApplicationAnswerRow } from "./answers.js";
import type { CandidateFactRow } from "./facts.js";
import {
  buildIntakeChecklist,
  evaluateAnswerStatus,
  evaluateChecklist,
  evaluateFactStatus,
  evaluatePreferenceStatus,
  REQUIRED_ANSWERS,
  REQUIRED_FACTS,
  REQUIRED_PREFERENCES,
} from "./intake.js";
import type { PreferenceRow } from "./preferences.js";
import { db } from "./test-db.js";

describe("evaluateFactStatus (pure)", () => {
  it("is missing when there is no row", () => {
    expect(evaluateFactStatus(undefined)).toBe("missing");
  });
  it("is complete when candidate_confirmed", () => {
    expect(evaluateFactStatus({ sourceType: "candidate_confirmed" })).toBe("complete");
  });
  it("is unverified for agent_inferred, outcome_learned, or needs_confirmation", () => {
    expect(evaluateFactStatus({ sourceType: "agent_inferred" })).toBe("unverified");
    expect(evaluateFactStatus({ sourceType: "outcome_learned" })).toBe("unverified");
    expect(evaluateFactStatus({ sourceType: "needs_confirmation" })).toBe("unverified");
  });
});

describe("evaluatePreferenceStatus (pure)", () => {
  it("is missing when there is no row or the row is inactive", () => {
    expect(evaluatePreferenceStatus(undefined)).toBe("missing");
    expect(evaluatePreferenceStatus({ source: "candidate_confirmed", active: false })).toBe("missing");
  });
  it("is complete when active and candidate_confirmed", () => {
    expect(evaluatePreferenceStatus({ source: "candidate_confirmed", active: true })).toBe("complete");
  });
  it("is unverified when active but not candidate_confirmed", () => {
    expect(evaluatePreferenceStatus({ source: "agent_inferred", active: true })).toBe("unverified");
  });
});

describe("evaluateAnswerStatus (pure)", () => {
  it("is missing, unverified, or complete based on the verified flag", () => {
    expect(evaluateAnswerStatus(undefined)).toBe("missing");
    expect(evaluateAnswerStatus({ verified: false })).toBe("unverified");
    expect(evaluateAnswerStatus({ verified: true })).toBe("complete");
  });
});

describe("evaluateChecklist (pure, in-memory fixtures)", () => {
  it("lists every required item as missing against an empty profile", () => {
    const items = evaluateChecklist([], [], []);
    const ids = items.map((i) => i.id).sort();
    const expectedIds = [
      ...REQUIRED_FACTS.map((f) => f.id),
      ...REQUIRED_PREFERENCES.map((p) => p.id),
      ...REQUIRED_ANSWERS.map((a) => a.id),
    ].sort();
    expect(ids).toEqual(expectedIds);
    expect(items.every((i) => i.status === "missing")).toBe(true);
  });

  it("omits items that are fully satisfied and flags unverified ones", () => {
    const now = new Date();
    const facts: CandidateFactRow[] = [
      {
        id: "f1",
        candidateId: "c1",
        category: "contact",
        key: "phone",
        value: { number: "555-0100" },
        sourceType: "candidate_confirmed",
        sourceReference: null,
        confidence: "1.00",
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      } as CandidateFactRow,
      {
        id: "f2",
        candidateId: "c1",
        category: "education",
        key: "degree",
        value: { school: "State University" },
        sourceType: "agent_inferred",
        sourceReference: null,
        confidence: "0.60",
        verifiedAt: null,
        createdAt: now,
        updatedAt: now,
      } as CandidateFactRow,
    ];

    const prefs: PreferenceRow[] = [
      {
        id: "p1",
        candidateId: "c1",
        type: "compensation",
        value: { minimum: 50000 },
        strength: "hard_constraint",
        source: "candidate_confirmed",
        confidence: "1.00",
        active: true,
        createdAt: now,
        updatedAt: now,
      } as PreferenceRow,
    ];

    const answers: ApplicationAnswerRow[] = [];

    const items = evaluateChecklist(facts, prefs, answers);
    const byId = new Map(items.map((i) => [i.id, i]));

    // Satisfied -> not present in the checklist at all.
    expect(byId.has("contact.phone")).toBe(false);
    expect(byId.has("preference.compensation")).toBe(false);

    // Present but not candidate-confirmed -> unverified, still on the list.
    expect(byId.get("education.degree")?.status).toBe("unverified");

    // Never provided -> missing.
    expect(byId.get("contact.email")?.status).toBe("missing");
    expect(byId.get("preference.geography")?.status).toBe("missing");
  });
});

describe("buildIntakeChecklist (live DB, seeded fixture shape)", () => {
  it("matches the profile-completion gaps implied by the seeded 'Cai' candidate", async () => {
    const [seededUser] = await db.select().from(users).where(eq(users.email, "cai@example.com"));
    if (!seededUser) {
      // The seed hasn't been run in this environment; skip rather than fail the suite.
      return;
    }
    const [seededCandidate] = await db
      .select()
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, seededUser.id));
    expect(seededCandidate).toBeDefined();

    const items = await buildIntakeChecklist(db, seededCandidate!.id);
    const ids = new Set(items.map((i) => i.id));

    // Seed fixtures never populate these — expected to still be outstanding.
    expect(ids.has("contact.phone")).toBe(true);
    expect(ids.has("contact.email")).toBe(true);
    expect(ids.has("employment.history")).toBe(true);
    expect(ids.has("preference.geography")).toBe(true);
    // No verified application_answers row is seeded, even though the raw fact exists.
    expect(ids.has("answer.standard.work_authorization")).toBe(true);

    // Seed fixtures populate these as candidate_confirmed — should read as complete.
    expect(ids.has("answer.work_authorization")).toBe(false);
    expect(ids.has("education.degree")).toBe(false);
    expect(ids.has("preference.compensation")).toBe(false);
    expect(ids.has("preference.work_environment")).toBe(false);
  });
});
