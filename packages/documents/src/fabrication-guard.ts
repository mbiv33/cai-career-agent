/**
 * The fabrication guard (CLAUDE.md cardinal rule): every claim in a generated
 * document must trace to a candidateFact. Generated markdown carries inline
 * `[fact:<id>]` citations; this module verifies them against the digest's
 * allow-list, rejects output that is uncited or cites an unknown id, and
 * strips the citation tags for the copy that actually gets stored/sent.
 */
import { FabricationGuardError } from "./errors.js";

const CITATION_PATTERN = /\[fact:([^\]]+)\]/g;
const CITATION_TEST = /\[fact:[^\]]+\]/;
const BULLET_LINE = /^\s*[-*]\s+/;

/** All `[fact:<id>]` ids cited in a piece of generated text, de-duplicated in order of first appearance. */
export function extractCitedFactIds(text: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const id = match[1]?.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Removes citation tags (and any trailing whitespace they leave behind) for the stored/sent copy. */
export function stripCitations(text: string): string {
  return text.replace(/[ \t]*\[fact:[^\]]+\]/g, "").replace(/[ \t]+$/gm, "");
}

export type GuardMode = "resume" | "cover_letter";

export interface GuardResult {
  /** Distinct fact ids the model actually cited, in order of first appearance. */
  citedFactIds: string[];
  /** The document text with citation tags removed — this is what gets stored/sent. */
  strippedText: string;
}

/**
 * Verifies generated document text against the candidate facts digest.
 * Throws `FabricationGuardError` (never silently coerces) when:
 *  - any cited `[fact:id]` is not present in `validFactIds`, or
 *  - the output is too sparsely cited to trust:
 *      - resume: fewer than half of its bullet (`- `/`* `) lines carry a citation
 *      - cover letter: it cites no facts at all
 */
export function verifyCitations(rawText: string, validFactIds: Set<string>, mode: GuardMode): GuardResult {
  const citedFactIds = extractCitedFactIds(rawText);

  const unknownIds = citedFactIds.filter((id) => !validFactIds.has(id));
  if (unknownIds.length > 0) {
    throw new FabricationGuardError(
      `Generated document cites fact id(s) not present in the candidate facts digest: ${unknownIds.join(", ")}. ` +
        "Refusing — every claim must trace to a candidateFact.",
      { unknownIds, citedFactIds },
    );
  }

  if (mode === "resume") {
    const bulletLines = rawText.split("\n").filter((line) => BULLET_LINE.test(line));
    const totalBullets = bulletLines.length;
    const citedBullets = bulletLines.filter((line) => CITATION_TEST.test(line)).length;
    if (totalBullets > 0 && citedBullets / totalBullets < 0.5) {
      throw new FabricationGuardError(
        `Only ${citedBullets}/${totalBullets} résumé bullet lines carry a [fact:id] citation; ` +
          "at least half must be traceable to a candidateFact.",
        { totalBullets, citedBullets },
      );
    }
  } else {
    if (citedFactIds.length === 0) {
      throw new FabricationGuardError(
        "Cover letter cites no candidate facts; every substantive claim must trace to a candidateFact.",
        { citedFactIds },
      );
    }
  }

  return { citedFactIds, strippedText: stripCitations(rawText) };
}
