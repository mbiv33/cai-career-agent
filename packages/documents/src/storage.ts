/**
 * Local document store (Stage 2). Generated résumés/cover letters are written
 * as markdown files under `var/documents/<candidateId>/<docId>.md` — `var/`
 * is gitignored, dev/local only. Production may later move this to Vercel
 * Blob/Neon; the interface is kept deliberately minimal (save/load by path)
 * so swapping the backend doesn't touch callers.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Relative to the process cwd unless a `root` override is passed. */
export const DEFAULT_DOCUMENT_ROOT = "var/documents";

export interface SaveDocumentInput {
  candidateId: string;
  docId: string;
  content: string;
  /** Override the storage root — mainly for tests. */
  root?: string;
}

/** Pure path-computation, split out so callers/tests can predict it without I/O. */
export function documentStoragePath(
  candidateId: string,
  docId: string,
  root: string = DEFAULT_DOCUMENT_ROOT,
): string {
  return path.join(root, candidateId, `${docId}.md`);
}

/** Writes the markdown file, creating parent directories as needed. Returns the storage path to persist on the `documents` row. */
export async function saveDocument(input: SaveDocumentInput): Promise<string> {
  const storagePath = documentStoragePath(input.candidateId, input.docId, input.root);
  await mkdir(path.dirname(storagePath), { recursive: true });
  await writeFile(storagePath, input.content, "utf8");
  return storagePath;
}

/** Reads a document back by its stored `storagePath`. */
export async function loadDocument(storagePath: string): Promise<string> {
  return readFile(storagePath, "utf8");
}
