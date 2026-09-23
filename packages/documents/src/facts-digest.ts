/**
 * Assembles the ONLY candidate information a document-generation model call
 * ever sees: a structured, plain-text digest of `candidateFacts`, grouped by
 * category, with every line tagged `[fact:<id>]`. The generation prompts
 * (resume.ts, cover-letter.ts) require every substantive claim in their
 * output to cite one of these tags — this module is what makes that
 * traceable back to a real candidateFact (CLAUDE.md: never fabricate).
 */
import type { Db } from "@cai/db";
import { getFacts, type CandidateFactRow } from "@cai/knowledge";

/** Preferred display order; any other categories present are appended, sorted. */
const CATEGORY_ORDER = [
  "education",
  "employment",
  "athletic",
  "skill",
  "accomplishment",
  "certification",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  education: "EDUCATION",
  employment: "EMPLOYMENT",
  athletic: "ATHLETIC",
  skill: "SKILLS",
  accomplishment: "ACCOMPLISHMENTS",
  certification: "CERTIFICATIONS",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Fallback for shapes we don't have a bespoke formatter for: "key: value, key2: value2". */
function formatGeneric(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => formatGeneric(v)).join(", ");
  const record = asRecord(value);
  if (record) {
    return Object.entries(record)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${typeof v === "object" ? formatGeneric(v) : String(v)}`)
      .join(", ");
  }
  return String(value);
}

function joinNonEmpty(parts: Array<unknown>, sep: string): string {
  return parts
    .filter((p) => p !== null && p !== undefined && p !== "")
    .map((p) => String(p))
    .join(sep);
}

function formatFactLine(category: string, rawValue: unknown): string {
  const value = asRecord(rawValue);

  switch (category) {
    case "education": {
      if (!value) break;
      const headline = joinNonEmpty([value.degree, value.field], " ");
      const line = joinNonEmpty([headline, value.school, value.year], ", ");
      if (line) return line;
      break;
    }
    case "employment": {
      if (!value) break;
      const head = joinNonEmpty([value.title, value.employer ?? value.company], ", ");
      const range = joinNonEmpty([value.start, value.end], " – ");
      const tail = range ? ` (${range})` : "";
      const desc = value.description ? `: ${String(value.description)}` : "";
      if (head) return `${head}${tail}${desc}`;
      break;
    }
    case "athletic": {
      if (!value) break;
      const head = joinNonEmpty([value.sport, value.level], " — ");
      const years = value.years ? ` (${value.years} years)` : "";
      if (head) return `${head}${years}`;
      break;
    }
    case "skill": {
      if (typeof rawValue === "string") return rawValue;
      if (!value) break;
      const name = value.name ?? value.skill;
      const level = value.level ? ` (${String(value.level)})` : "";
      if (name) return `${String(name)}${level}`;
      break;
    }
    case "accomplishment": {
      if (typeof rawValue === "string") return rawValue;
      if (!value) break;
      const desc = value.description ?? value.detail;
      if (desc) return String(desc);
      break;
    }
    case "certification": {
      if (!value) break;
      const head = joinNonEmpty([value.name, value.issuer], ", ");
      const year = value.year ? ` (${value.year})` : "";
      if (head) return `${head}${year}`;
      break;
    }
    default:
      break;
  }

  return formatGeneric(rawValue);
}

function groupByCategory(facts: CandidateFactRow[]): Map<string, CandidateFactRow[]> {
  const byCategory = new Map<string, CandidateFactRow[]>();
  for (const fact of facts) {
    const list = byCategory.get(fact.category) ?? [];
    list.push(fact);
    byCategory.set(fact.category, list);
  }
  return byCategory;
}

/**
 * Builds the plain-text facts digest for a candidate. This string is the
 * entire candidate-information payload sent to a document-generation model
 * call — nothing else about the candidate is ever included in that prompt.
 */
export async function buildFactsDigest(db: Db, candidateId: string): Promise<string> {
  const facts = await getFacts(db, candidateId);
  const byCategory = groupByCategory(facts);

  const known = new Set<string>(CATEGORY_ORDER);
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !known.has(c)).sort(),
  ];

  if (orderedCategories.length === 0) {
    return "(no candidate facts on file)";
  }

  const sections = orderedCategories.map((category) => {
    const rows = byCategory.get(category)!;
    const label = CATEGORY_LABELS[category] ?? category.toUpperCase();
    const lines = rows.map((row) => `[fact:${row.id}] ${formatFactLine(category, row.value)}`);
    return `${label}:\n${lines.join("\n")}`;
  });

  return sections.join("\n\n");
}

/** Every `[fact:<id>]` tag present in a digest — the citation allow-list for the fabrication guard. */
export function extractFactIdsFromDigest(digest: string): Set<string> {
  const ids = new Set<string>();
  for (const match of digest.matchAll(/\[fact:([^\]]+)\]/g)) {
    const id = match[1]?.trim();
    if (id) ids.add(id);
  }
  return ids;
}
