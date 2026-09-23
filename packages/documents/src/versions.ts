/**
 * Document version lineage (spec §5.6: "Maintain document and version
 * history"). `documents.parentDocumentId` chains a tailored version back to
 * the baseline it was generated from; this module walks that chain.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@cai/db";
import { documents } from "@cai/db";
import type { DocumentRow } from "./shared.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Walks the `parentDocumentId` chain from `docId` back to its root, returning
 * the ordered version history — oldest (root) first, `docId` itself last.
 * Guards against a cyclical chain (should never happen) by stopping at the
 * first repeated id rather than looping forever.
 */
export async function getDocumentLineage(db: Db, docId: string): Promise<DocumentRow[]> {
  const chain: DocumentRow[] = [];
  const seen = new Set<string>();
  let currentId: string | null = docId;

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const [row] = await db.select().from(documents).where(eq(documents.id, currentId)).limit(1);
    if (!row) break;
    chain.push(row);
    currentId = row.parentDocumentId;
  }

  return chain.reverse();
}

/**
 * Most recent résumé document for a candidate, optionally scoped to a job
 * (matched against `meta.jobId`, since `documents` isn't job-scoped in the
 * schema). Undefined if none exists yet.
 */
export async function latestResumeFor(db: Db, candidateId: string, jobId?: string): Promise<DocumentRow | undefined> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.candidateId, candidateId), eq(documents.kind, "resume")))
    .orderBy(desc(documents.createdAt));

  if (!jobId) return rows[0];
  return rows.find((row) => asRecord(row.meta)?.jobId === jobId);
}
