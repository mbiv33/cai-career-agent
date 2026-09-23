import { describe, expect, it } from "vitest";
import { FabricationGuardError } from "./errors.js";
import { extractCitedFactIds, stripCitations, verifyCitations } from "./fabrication-guard.js";

const VALID_IDS = new Set(["fact-1", "fact-2", "fact-3"]);

describe("extractCitedFactIds", () => {
  it("returns distinct ids in order of first appearance", () => {
    const text = "- A [fact:fact-1]\n- B [fact:fact-2][fact:fact-1]";
    expect(extractCitedFactIds(text)).toEqual(["fact-1", "fact-2"]);
  });

  it("returns an empty array when nothing is cited", () => {
    expect(extractCitedFactIds("Just plain prose.")).toEqual([]);
  });
});

describe("stripCitations", () => {
  it("removes citation tags and trailing whitespace they leave behind", () => {
    const stripped = stripCitations("- Led the crew [fact:fact-1]\n- Ran ops [fact:fact-2] [fact:fact-3]");
    expect(stripped).toBe("- Led the crew\n- Ran ops");
    expect(stripped).not.toMatch(/\[fact:/);
  });
});

describe("verifyCitations — résumé mode", () => {
  it("rejects output citing a fact id absent from the digest", () => {
    const text = "# Résumé\n- Did a thing [fact:not-real]\n- Did another thing [fact:fact-1]";
    expect(() => verifyCitations(text, VALID_IDS, "resume")).toThrow(FabricationGuardError);
    try {
      verifyCitations(text, VALID_IDS, "resume");
    } catch (err) {
      expect(err).toBeInstanceOf(FabricationGuardError);
      expect((err as FabricationGuardError).context?.unknownIds).toEqual(["not-real"]);
    }
  });

  it("rejects output where fewer than half the bullet lines carry a citation", () => {
    const text = [
      "# Résumé",
      "- Cited bullet [fact:fact-1]",
      "- Uncited bullet one",
      "- Uncited bullet two",
      "- Uncited bullet three",
    ].join("\n");
    expect(() => verifyCitations(text, VALID_IDS, "resume")).toThrow(FabricationGuardError);
    try {
      verifyCitations(text, VALID_IDS, "resume");
    } catch (err) {
      expect((err as FabricationGuardError).message).toMatch(/1\/4/);
    }
  });

  it("accepts well-cited output, strips tags, and returns the cited ids", () => {
    const text = [
      "# Résumé",
      "## Experience",
      "- Led a 12-person crew [fact:fact-1]",
      "- Completed B.S. in Kinesiology [fact:fact-2]",
      "- Ran daily route operations [fact:fact-1]",
    ].join("\n");

    const result = verifyCitations(text, VALID_IDS, "resume");
    expect(result.citedFactIds).toEqual(["fact-1", "fact-2"]);
    expect(result.strippedText).not.toMatch(/\[fact:/);
    expect(result.strippedText).toContain("Led a 12-person crew");
  });

  it("does not reject output with no bullet lines at all (nothing to ratio against)", () => {
    const text = "# Résumé\nJust a header, no bullets yet.";
    expect(() => verifyCitations(text, VALID_IDS, "resume")).not.toThrow();
  });
});

describe("verifyCitations — cover letter mode", () => {
  it("rejects a letter that cites no candidate facts", () => {
    const text = "Dear Hiring Manager,\n\nI would be a great fit for this role.\n\nSincerely,\nCandidate";
    expect(() => verifyCitations(text, VALID_IDS, "cover_letter")).toThrow(FabricationGuardError);
  });

  it("rejects a letter citing an unknown fact id even if another citation is valid", () => {
    const text = "I bring relevant experience [fact:fact-1] and also [fact:invented].";
    expect(() => verifyCitations(text, VALID_IDS, "cover_letter")).toThrow(FabricationGuardError);
  });

  it("accepts a letter citing 2-3 real facts and strips the tags", () => {
    const text = [
      "Dear Hiring Manager,",
      "",
      "My background in field operations [fact:fact-1] and my degree [fact:fact-2] make me a strong",
      "candidate for this role at Acme Co.",
      "",
      "Sincerely,",
      "Candidate",
    ].join("\n");

    const result = verifyCitations(text, VALID_IDS, "cover_letter");
    expect(result.citedFactIds).toEqual(["fact-1", "fact-2"]);
    expect(result.strippedText).not.toMatch(/\[fact:/);
  });
});
