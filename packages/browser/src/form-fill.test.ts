import { describe, expect, it } from "vitest";
import type { AnswerResolution } from "@cai/core";
import {
  extractFillValue,
  fieldToQuestion,
  isAmbiguousField,
  mapFieldsWithModel,
  type FormField,
  type ModelRequest,
  type ModelResponse,
  type ModelRunner,
} from "./form-fill.js";

function field(overrides: Partial<FormField> = {}): FormField {
  return { index: 0, tagName: "input", type: "text", ...overrides };
}

describe("fieldToQuestion (pure)", () => {
  it("prefers the label, stripping trailing colons/asterisks", () => {
    expect(fieldToQuestion(field({ label: "Full Name:" }))).toBe("Full Name");
    expect(fieldToQuestion(field({ label: "Email *" }))).toBe("Email");
  });

  it("falls back to placeholder when there is no label", () => {
    expect(fieldToQuestion(field({ placeholder: "you@example.com" }))).toBe("you@example.com");
  });

  it("falls back to a humanized name when there is no label or placeholder", () => {
    expect(fieldToQuestion(field({ name: "phone_number" }))).toBe("phone number");
    expect(fieldToQuestion(field({ name: "workAuthorization" }))).toBe("work Authorization");
  });

  it("falls back to a generic index label as a last resort", () => {
    expect(fieldToQuestion(field({ index: 3 }))).toBe("Field 3");
  });
});

describe("isAmbiguousField (pure)", () => {
  it("is false when a label is present", () => {
    expect(isAmbiguousField(field({ label: "Full Name" }))).toBe(false);
  });

  it("is false when a placeholder is present", () => {
    expect(isAmbiguousField(field({ placeholder: "Full Name" }))).toBe(false);
  });

  it("is true with no name at all", () => {
    expect(isAmbiguousField(field({}))).toBe(true);
  });

  it("is true for generic generated names", () => {
    expect(isAmbiguousField(field({ name: "field3" }))).toBe(true);
    expect(isAmbiguousField(field({ name: "q_12" }))).toBe(true);
    expect(isAmbiguousField(field({ name: "input-1" }))).toBe(true);
  });

  it("is false for a meaningful name", () => {
    expect(isAmbiguousField(field({ name: "desiredSalary" }))).toBe(false);
  });
});

describe("extractFillValue (pure)", () => {
  it("returns undefined for an escalate resolution", () => {
    const resolution: AnswerResolution = { kind: "escalate", question: "x" };
    expect(extractFillValue(resolution)).toBeUndefined();
  });

  it("unwraps a {question, answer} shaped fact/answer value", () => {
    const resolution: AnswerResolution = {
      kind: "candidate_fact",
      factId: "f1",
      value: { question: "Are you authorized to work in the US?", answer: "Yes" },
    };
    expect(extractFillValue(resolution)).toBe("Yes");
  });

  it("passes through a plain scalar value untouched", () => {
    const resolution: AnswerResolution = { kind: "verified_answer", answerId: "a1", value: "Yes, U.S. citizen" };
    expect(extractFillValue(resolution)).toBe("Yes, U.S. citizen");
    const derived: AnswerResolution = { kind: "derived", value: 4, derivation: "x" };
    expect(extractFillValue(derived)).toBe(4);
  });
});

class FakeRunner implements ModelRunner {
  public calls: ModelRequest[] = [];
  constructor(private readonly response: ModelResponse) {}
  async run(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(req);
    return this.response;
  }
}

describe("mapFieldsWithModel — JSON-validated with deterministic fallback", () => {
  const fields: FormField[] = [
    field({ index: 0, name: "f0" }),
    field({ index: 1, name: "f1" }),
  ];

  it("maps fields from a well-formed JSON array response", async () => {
    const runner = new FakeRunner({
      text: JSON.stringify([
        { index: 0, question: "What is your desired salary?" },
        { index: 1, question: "When can you start?" },
      ]),
    });
    const result = await mapFieldsWithModel(runner, fields);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.task).toBe("map_form_fields");
    expect(result.get(0)).toBe("What is your desired salary?");
    expect(result.get(1)).toBe("When can you start?");
  });

  it("drops entries whose index doesn't correspond to a real field", async () => {
    const runner = new FakeRunner({ text: JSON.stringify([{ index: 99, question: "Nonexistent" }]) });
    const result = await mapFieldsWithModel(runner, fields);
    expect(result.size).toBe(0);
  });

  it("falls back to an empty map on malformed JSON", async () => {
    const runner = new FakeRunner({ text: "not json at all" });
    const result = await mapFieldsWithModel(runner, fields);
    expect(result.size).toBe(0);
  });

  it("falls back to an empty map when the JSON isn't an array", async () => {
    const runner = new FakeRunner({ text: JSON.stringify({ index: 0, question: "x" }) });
    const result = await mapFieldsWithModel(runner, fields);
    expect(result.size).toBe(0);
  });

  it("skips malformed entries within an otherwise valid array", async () => {
    const runner = new FakeRunner({
      text: JSON.stringify([{ index: 0, question: "Valid" }, { index: 1 }, "garbage", { question: "no index" }]),
    });
    const result = await mapFieldsWithModel(runner, fields);
    expect(result.get(0)).toBe("Valid");
    expect(result.size).toBe(1);
  });

  it("returns an empty map without calling the runner when there are no ambiguous fields", async () => {
    const runner = new FakeRunner({ text: "[]" });
    const result = await mapFieldsWithModel(runner, []);
    expect(runner.calls).toHaveLength(0);
    expect(result.size).toBe(0);
  });
});
