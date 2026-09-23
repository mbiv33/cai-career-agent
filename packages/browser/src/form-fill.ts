/**
 * Application form filler (Technical Build Spec §9 — form detection, form
 * population, file upload, multi-page workflow support, interruption/
 * resume).
 *
 * Every text field is resolved through `resolveAnswer` (@cai/knowledge) —
 * the strict verified-answer → candidate-fact → derivation → escalate
 * order. This module never invents a value: a field with no resolution
 * becomes one entry in a single batched escalation, never a guess.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import type { Db } from "@cai/db";
import { createEscalation, type AnswerResolution } from "@cai/core";
import { normalizeQuestion, recordAnswerUsage, resolveAnswer } from "@cai/knowledge";
import type { PortalSession } from "./session.js";
import { detectObstacle, escalateForObstacle } from "./session.js";

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormField {
  /** Stable within one extraction pass — set as `data-cai-field="<index>"` on the element. */
  index: number;
  tagName: "input" | "select" | "textarea";
  type: string; // input type (text/email/tel/file/checkbox/...), or "select-one"/"textarea"
  name?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  options?: FormFieldOption[];
}

const SKIPPED_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

/**
 * Walks the current page's form controls, tags each with a stable
 * `data-cai-field` index, and returns their extracted label/name/type. Pure
 * DOM inspection — no navigation, no filling.
 */
export async function extractFields(page: Page): Promise<FormField[]> {
  return page.evaluate(() => {
    const results: FormField[] = [];
    const elements = Array.from(document.querySelectorAll("input, select, textarea")) as Array<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >;

    let index = 0;
    for (const el of elements) {
      const tagName = el.tagName.toLowerCase() as FormField["tagName"];
      const type = tagName === "input" ? (el as HTMLInputElement).type || "text" : tagName === "select" ? "select-one" : "textarea";
      if (tagName === "input" && ["hidden", "submit", "button", "reset", "image"].includes(type)) continue;

      el.setAttribute("data-cai-field", String(index));

      let label: string | undefined;
      if (el.id) {
        const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (forLabel?.textContent) label = forLabel.textContent.trim();
      }
      if (!label) {
        const wrappingLabel = el.closest("label");
        if (wrappingLabel?.textContent) label = wrappingLabel.textContent.trim();
      }
      if (!label) {
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel) label = ariaLabel.trim();
      }

      const field: FormField = {
        index,
        tagName,
        type,
        name: el.getAttribute("name") ?? undefined,
        id: el.id || undefined,
        label,
        placeholder: (el as HTMLInputElement).placeholder || undefined,
        required: el.hasAttribute("required") || undefined,
      };

      if (tagName === "select") {
        field.options = Array.from((el as HTMLSelectElement).options).map((o) => ({
          value: o.value,
          label: (o.textContent ?? o.value).trim(),
        }));
      }

      results.push(field);
      index++;
    }
    return results;
  });
}

/** Best-effort human-readable question for a field with no usable label/placeholder. */
function humanizeName(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

/** Turns a field's label/placeholder/name into the question text passed to `resolveAnswer`. */
export function fieldToQuestion(field: FormField): string {
  const label = field.label?.replace(/[*:]+\s*$/, "").trim();
  if (label) return label;
  if (field.placeholder?.trim()) return field.placeholder.trim();
  if (field.name?.trim()) return humanizeName(field.name.trim());
  return `Field ${field.index}`;
}

const AMBIGUOUS_NAME_RE = /^(field|input|q|question|f)[-_]?\d+$/i;

/** True when a field has no usable label/placeholder and a generic/generated name — a candidate for LLM-assisted mapping. */
export function isAmbiguousField(field: FormField): boolean {
  if (field.label?.trim()) return false;
  if (field.placeholder?.trim()) return false;
  if (!field.name?.trim()) return true;
  return AMBIGUOUS_NAME_RE.test(field.name.trim());
}

// ---------------------------------------------------------------------------
// Optional LLM-assisted field mapping (map_form_fields task)
// ---------------------------------------------------------------------------

/**
 * Minimal, structurally-compatible mirror of `@cai/agents`'s `ModelRunner` —
 * intentionally not a dependency on `@cai/agents` (this package only depends
 * on @cai/db, @cai/core, @cai/knowledge, and playwright). Any real
 * `ModelRunner` (e.g. `ClaudeCodeRunner`) satisfies this interface as-is and
 * can be passed straight through.
 */
export interface ModelRequest {
  task: string; // "map_form_fields" in @cai/agents' TASK_TIERS
  system?: string;
  prompt: string;
  maxTokens?: number;
}

export interface ModelResponse {
  text: string;
  usage?: unknown;
}

export interface ModelRunner {
  run(req: ModelRequest): Promise<ModelResponse>;
}

interface MapFieldsModelEntry {
  index: number;
  question: string;
}

function isMapFieldsModelEntry(value: unknown): value is MapFieldsModelEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).index === "number" &&
    typeof (value as Record<string, unknown>).question === "string" &&
    ((value as Record<string, unknown>).question as string).trim().length > 0
  );
}

/**
 * Asks the model to map ambiguous fields to canonical question text.
 * JSON-validated: anything that isn't a well-formed `{index, question}[]`
 * array — bad JSON, wrong shape, an index that doesn't exist — is dropped.
 * Dropped fields fall through to `fieldToQuestion`'s deterministic fallback,
 * which for a truly ambiguous field will very likely fail to resolve and
 * escalate rather than silently guessing.
 */
export async function mapFieldsWithModel(runner: ModelRunner, fields: FormField[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (fields.length === 0) return result;

  const validIndexes = new Set(fields.map((f) => f.index));
  const prompt = [
    "You are mapping ambiguous job-application form fields to canonical question text.",
    'Return ONLY a JSON array of {"index": number, "question": string} objects — one entry per field you can confidently map, using the field\'s index. Skip any field you are not confident about; do not guess.',
    "Fields:",
    JSON.stringify(
      fields.map((f) => ({ index: f.index, name: f.name, label: f.label, placeholder: f.placeholder, type: f.type })),
    ),
  ].join("\n");

  try {
    const response = await runner.run({ task: "map_form_fields", prompt });
    const parsed: unknown = JSON.parse(response.text);
    if (!Array.isArray(parsed)) return result; // deterministic fallback: nothing mapped
    for (const entry of parsed) {
      if (isMapFieldsModelEntry(entry) && validIndexes.has(entry.index)) {
        result.set(entry.index, entry.question.trim());
      }
    }
  } catch {
    // Malformed JSON or runner failure — deterministic fallback: skip, leave unresolved.
  }
  return result;
}

// ---------------------------------------------------------------------------
// Resolving an AnswerResolution down to a fillable value
// ---------------------------------------------------------------------------

/** Candidate facts / verified answers may be a plain scalar, or a `{question, answer}` shape (seed convention) — extract the fillable part. */
export function extractFillValue(resolution: AnswerResolution): unknown {
  if (resolution.kind === "escalate") return undefined;
  const value = resolution.value;
  if (value && typeof value === "object" && !Array.isArray(value) && "answer" in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>).answer;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Filling a single field (human-paced via PortalSession)
// ---------------------------------------------------------------------------

function fieldSelector(field: FormField): string {
  return `[data-cai-field="${field.index}"]`;
}

async function selectBestOption(locator: Locator, field: FormField, value: unknown): Promise<void> {
  const text = String(value).trim().toLowerCase();
  const options = field.options ?? [];
  const byValue = options.find((o) => o.value.trim().toLowerCase() === text);
  const byLabel = options.find((o) => o.label.trim().toLowerCase() === text);
  const match = byValue ?? byLabel;
  if (match) {
    await locator.selectOption(match.value);
  } else {
    // No exact match — don't guess a different option; attempt Playwright's own label match as a last resort.
    await locator.selectOption({ label: String(value) }).catch(() => undefined);
  }
}

async function fillField(session: PortalSession, page: Page, field: FormField, value: unknown): Promise<void> {
  if (value === undefined || value === null) return;
  const locator = page.locator(fieldSelector(field));

  if (field.tagName === "select") {
    await selectBestOption(locator, field, value);
    return;
  }
  if (field.type === "checkbox") {
    await locator.setChecked(Boolean(value));
    return;
  }
  if (field.type === "radio") {
    // Only act when this specific radio's value matches — never select an arbitrary option in the group.
    const radioValue = (await locator.getAttribute("value"))?.trim().toLowerCase();
    if (radioValue && radioValue === String(value).trim().toLowerCase()) {
      await locator.check();
    }
    return;
  }
  // text / email / tel / number / date / textarea / etc.
  await session.typeSlow(locator, String(value));
}

// ---------------------------------------------------------------------------
// File uploads (résumé / cover letter)
// ---------------------------------------------------------------------------

const RESUME_RE = /\br[ée]sum[ée]\b|\bcv\b/i;
const COVER_LETTER_RE = /cover letter/i;

/** Uploads a specific file to a specific (file-type) field. */
export async function uploadDocument(page: Page, field: FormField, filePath: string): Promise<void> {
  await page.locator(fieldSelector(field)).setInputFiles(filePath);
}

/** Matches a file-input field to a résumé or cover-letter path by its label/placeholder/name, if either is configured. */
function classifyFileField(
  field: FormField,
  documents: { resumePath?: string; coverLetterPath?: string },
): string | undefined {
  const haystack = [field.label, field.placeholder, field.name].filter(Boolean).join(" ");
  if (COVER_LETTER_RE.test(haystack)) return documents.coverLetterPath;
  if (RESUME_RE.test(haystack)) return documents.resumePath;
  // Default a lone, unlabeled file field to the résumé — the overwhelmingly common case.
  return documents.resumePath;
}

// ---------------------------------------------------------------------------
// Persisted fill state (interruption/resume, spec §9)
// ---------------------------------------------------------------------------

export interface FormFillState {
  applicationId: string;
  url: string;
  /** Keyed by `normalizeQuestion(question)` — stable across DOM re-extraction and page reloads. */
  filled: Record<string, unknown>;
  pending: string[];
  escalationId?: string;
  updatedAt: string;
}

const FORM_STATE_DIR = "var/form-state";

function formStatePath(applicationId: string): string {
  return path.join(FORM_STATE_DIR, `${applicationId}.json`);
}

export async function loadFormFillState(applicationId: string): Promise<FormFillState | undefined> {
  try {
    const raw = await readFile(formStatePath(applicationId), "utf8");
    return JSON.parse(raw) as FormFillState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function saveFormFillState(state: FormFillState): Promise<void> {
  await mkdir(FORM_STATE_DIR, { recursive: true });
  await writeFile(formStatePath(state.applicationId), JSON.stringify(state, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// The filler
// ---------------------------------------------------------------------------

export interface FillApplicationFormOptions {
  db: Db;
  session: PortalSession;
  page: Page;
  candidateId: string;
  applicationId: string;
  jobId?: string;
  /** Which agent is running this fill (for escalation/audit attribution). */
  raisedBy: string;
  resumePath?: string;
  coverLetterPath?: string;
  /** Optional LLM assist for ambiguous field labels (map_form_fields task). */
  runner?: ModelRunner;
  /** Safety valve against a runaway "Continue" loop. Default 5. */
  maxPages?: number;
}

export interface FillApplicationFormResult {
  state: FormFillState;
  escalationId?: string;
  /** Set when an obstacle (captcha/mfa) stopped the fill before it could finish — the caller must not proceed. */
  obstacle?: "captcha" | "mfa";
}

const CONTINUE_SELECTOR =
  'button:has-text("Continue"), button:has-text("Next"), input[type="submit"][value*="Continue" i], input[type="submit"][value*="Next" i], a:has-text("Continue")';
const SUBMIT_SELECTOR = 'button:has-text("Submit"), input[type="submit"][value*="Submit" i]';

/**
 * Fills every resolvable field across as many "Continue"-linked pages as the
 * form has, stops at the page with the final submit control (submission
 * itself is `submit.ts`'s job), and batches every unresolved question into
 * exactly one escalation per distinct pending set — never re-escalating an
 * identical pending set on resume.
 */
export async function fillApplicationForm(options: FillApplicationFormOptions): Promise<FillApplicationFormResult> {
  const { db, session, page, candidateId, applicationId, raisedBy } = options;
  const maxPages = options.maxPages ?? 5;

  const previous = await loadFormFillState(applicationId);
  const state: FormFillState = previous ?? {
    applicationId,
    url: page.url(),
    filled: {},
    pending: [],
    updatedAt: new Date().toISOString(),
  };

  const pendingThisRun = new Set<string>();

  for (let hop = 0; hop < maxPages; hop++) {
    const obstacle = await detectObstacle(page);
    if (obstacle === "captcha" || obstacle === "mfa") {
      const escalation = await escalateForObstacle(db, obstacle, {
        candidateId,
        applicationId,
        jobId: options.jobId,
        raisedBy,
        portal: session.portal,
        pageUrl: page.url(),
      });
      state.updatedAt = new Date().toISOString();
      await saveFormFillState(state);
      return { state, escalationId: escalation.id, obstacle };
    }
    // login_required is surfaced by the caller (session start / submit) — a
    // mid-fill page with a password field on a job-application form is
    // vanishingly rare and not this function's contract to escalate.

    const fields = await extractFields(page);
    if (fields.length === 0) break;

    const ambiguous = fields.filter(isAmbiguousField);
    const modelMap = ambiguous.length > 0 && options.runner ? await mapFieldsWithModel(options.runner, ambiguous) : undefined;

    for (const field of fields) {
      if (field.type === "submit" || field.type === "button" || field.type === "reset") continue;

      if (field.type === "file") {
        const filePath = classifyFileField(field, options);
        if (filePath) {
          await uploadDocument(page, field, filePath);
          const key = normalizeQuestion(fieldToQuestion(field));
          state.filled[key] = filePath;
        }
        continue;
      }

      const question = modelMap?.get(field.index) ?? fieldToQuestion(field);
      const key = normalizeQuestion(question);

      if (key in state.filled) {
        await fillField(session, page, field, state.filled[key]);
        continue;
      }

      const resolution = await resolveAnswer(db, { candidateId, question });
      if (resolution.kind === "escalate") {
        pendingThisRun.add(question);
        continue;
      }

      const value = extractFillValue(resolution);
      await fillField(session, page, field, value);
      state.filled[key] = value;
      if (resolution.kind === "verified_answer") {
        await recordAnswerUsage(db, resolution.answerId);
      }
    }

    const hasContinue = (await page.locator(CONTINUE_SELECTOR).count()) > 0;
    const hasSubmit = (await page.locator(SUBMIT_SELECTOR).count()) > 0;
    if (hasContinue && !hasSubmit) {
      await session.clickWithDelay(page.locator(CONTINUE_SELECTOR).first());
      await page.waitForLoadState("domcontentloaded");
      state.url = page.url();
      continue;
    }
    break; // reached the final page (has a submit control, or neither) — stop here
  }

  const newPending = Array.from(pendingThisRun);
  const previousPendingSorted = [...state.pending].sort();
  const newPendingSorted = [...newPending].sort();
  const samePendingAsBefore =
    Boolean(state.escalationId) &&
    previousPendingSorted.length === newPendingSorted.length &&
    previousPendingSorted.every((q, i) => q === newPendingSorted[i]);

  state.pending = newPending;
  state.updatedAt = new Date().toISOString();

  let escalationId: string | undefined = state.escalationId;
  if (newPending.length > 0 && !samePendingAsBefore) {
    const escalation = await createEscalation(db, {
      candidateId,
      applicationId,
      jobId: options.jobId,
      type: "APPLICATION_QUESTION",
      priority: "ACTION",
      reason: `Application has ${newPending.length} unanswered question(s) with no verified answer, candidate fact, or authorized derivation.`,
      recommendedAction: "Answer the question(s) below; the answer is remembered for future applications.",
      requiredInput: newPending.map((q, i) => `${i + 1}. ${q}`).join("\n"),
      resumeImmediately: true,
      raisedBy,
    });
    escalationId = escalation.id;
    state.escalationId = escalation.id;
  } else if (newPending.length === 0) {
    escalationId = undefined;
    state.escalationId = undefined;
  }

  await saveFormFillState(state);
  return { state, escalationId };
}
