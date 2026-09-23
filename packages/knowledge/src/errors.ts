/**
 * Thrown whenever a write would silently degrade the provenance of candidate
 * knowledge — e.g. an agent-inferred value overwriting something the
 * candidate explicitly confirmed, or an agent trying to mint a hard
 * constraint on the candidate's behalf. Callers MUST catch this and route to
 * an escalation (`createEscalation` in @cai/core) rather than retry the
 * write; this package never resolves the conflict itself.
 */
export class ProvenanceConflictError extends Error {
  public readonly context: Record<string, unknown> | undefined;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "ProvenanceConflictError";
    this.context = context;
  }
}
