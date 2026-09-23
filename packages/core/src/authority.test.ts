import { describe, expect, it } from "vitest";
import { checkAuthority, DEFAULT_POLICIES } from "./authority.js";

describe("authority model", () => {
  it("auto-allows résumé tailoring without reporting", () => {
    expect(checkAuthority("resume.tailor")).toEqual({ allowed: true, level: "AUTO", report: false });
  });

  it("requires reporting for in-policy submissions", () => {
    const d = checkAuthority("application.submit_within_policy");
    expect(d.allowed).toBe(true);
    expect(d).toMatchObject({ report: true });
  });

  it("escalates human-required and ask-before actions", () => {
    expect(checkAuthority("application.answer_legal_disclosure")).toMatchObject({
      allowed: false,
      escalate: true,
    });
    expect(checkAuthority("strategy.change_salary_floor")).toMatchObject({
      allowed: false,
      escalate: true,
    });
  });

  it("never allows inventing information, even via override attempts", () => {
    expect(checkAuthority("facts.invent_information")).toMatchObject({
      allowed: false,
      level: "PROHIBITED",
      escalate: false,
    });
  });

  it("applies candidate overrides over defaults", () => {
    const d = checkAuthority("communication.send_substantive", {
      "communication.send_substantive": "AUTO_REPORT",
    });
    expect(d).toMatchObject({ allowed: true, report: true });
  });

  it("has a default policy for every action type", () => {
    for (const level of Object.values(DEFAULT_POLICIES)) {
      expect(level).toBeTruthy();
    }
  });
});
