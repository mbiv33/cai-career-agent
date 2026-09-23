import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertFact } from "@cai/knowledge";
import { buildFactsDigest, extractFactIdsFromDigest } from "./facts-digest.js";
import { cleanupTestCandidate, createTestCandidate, db, type TestCandidate } from "./test-db.js";

describe("buildFactsDigest", () => {
  let candidate: TestCandidate;

  beforeAll(async () => {
    candidate = await createTestCandidate("facts-digest");
    await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "education",
      key: "degree",
      value: { school: "State University", degree: "B.S.", field: "Kinesiology", year: 2024 },
      sourceType: "candidate_confirmed",
      actor: "test",
    });
    await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "athletic",
      key: "college_athletics",
      value: { sport: "Track & Field", level: "NCAA", years: 4 },
      sourceType: "candidate_confirmed",
      actor: "test",
    });
    await upsertFact(db, {
      candidateId: candidate.candidateId,
      category: "skill",
      key: "first_aid",
      value: "First Aid / CPR certified",
      sourceType: "candidate_confirmed",
      actor: "test",
    });
  });

  afterAll(async () => {
    await cleanupTestCandidate(candidate);
  });

  it("groups facts under category headers in preferred order and tags each line with its fact id", async () => {
    const digest = await buildFactsDigest(db, candidate.candidateId);

    const educationIdx = digest.indexOf("EDUCATION:");
    const athleticIdx = digest.indexOf("ATHLETIC:");
    const skillsIdx = digest.indexOf("SKILLS:");
    expect(educationIdx).toBeGreaterThanOrEqual(0);
    expect(athleticIdx).toBeGreaterThan(educationIdx);
    expect(skillsIdx).toBeGreaterThan(athleticIdx);

    expect(digest).toMatch(/\[fact:[^\]]+\] B\.S\. Kinesiology, State University, 2024/);
    expect(digest).toMatch(/\[fact:[^\]]+\] Track & Field — NCAA \(4 years\)/);
    expect(digest).toMatch(/\[fact:[^\]]+\] First Aid \/ CPR certified/);
  });

  it("round-trips through extractFactIdsFromDigest to the same ids the facts were stored under", async () => {
    const digest = await buildFactsDigest(db, candidate.candidateId);
    const ids = extractFactIdsFromDigest(digest);
    expect(ids.size).toBe(3);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("returns a placeholder for a candidate with no facts on file", async () => {
    const empty = await createTestCandidate("facts-digest-empty");
    try {
      const digest = await buildFactsDigest(db, empty.candidateId);
      expect(digest).toBe("(no candidate facts on file)");
      expect(extractFactIdsFromDigest(digest).size).toBe(0);
    } finally {
      await cleanupTestCandidate(empty);
    }
  });
});
