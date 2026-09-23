/**
 * Small, dependency-free JSON/shape helpers shared by discovery and
 * qualification. Kept tiny and boring on purpose — normalization and
 * qualification both need to treat model output and raw fixture JSON as
 * untrusted `unknown` and fail closed rather than coerce garbage.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function toStringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

/** Increments a StageResult counts bucket. Counts are declared as
 * `Record<string, number>` (contracts.ts) which, under
 * `noUncheckedIndexedAccess`, reads as `number | undefined` — this centralizes
 * the "default to 0" handling instead of repeating `?? 0` at every call site. */
export function bump(counts: Record<string, number>, key: string, delta = 1): void {
  counts[key] = (counts[key] ?? 0) + delta;
}
