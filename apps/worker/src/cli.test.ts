import { describe, expect, it } from "vitest";
import { makeRunId, parseArgs } from "./cli.js";

describe("parseArgs", () => {
  it("defaults to all stages, not dry-run, max-submissions 5", () => {
    const args = parseArgs([]);
    expect(args.dryRun).toBe(false);
    expect(args.maxSubmissions).toBe(5);
    expect(args.stages).toContain("discovery");
    expect(args.stages).toContain("briefing");
  });

  it("parses --dry-run, --stages, and --max-submissions", () => {
    const args = parseArgs(["--dry-run", "--stages", "discovery,qualification", "--max-submissions", "2"]);
    expect(args.dryRun).toBe(true);
    expect(args.stages).toEqual(["discovery", "qualification"]);
    expect(args.maxSubmissions).toBe(2);
  });

  it("throws on a malformed --max-submissions", () => {
    expect(() => parseArgs(["--max-submissions", "not-a-number"])).toThrow();
  });
});

describe("makeRunId", () => {
  it("produces a stable, sortable, filesystem-safe id from a timestamp", () => {
    const id = makeRunId(new Date("2026-09-23T09:00:00.000Z"));
    expect(id).toBe("run-2026-09-23T09-00-00");
    expect(id).not.toMatch(/[:.]/);
  });
});
