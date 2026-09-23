/**
 * Thrown whenever generated document output fails the fabrication guard —
 * it cites a fact id absent from the candidate's facts digest, or is too
 * sparsely cited to trust. Callers MUST NOT retry-and-coerce; the generation
 * is rejected outright and audited as `document.generation_rejected`
 * (CLAUDE.md: never fabricate candidate qualifications).
 */
export class FabricationGuardError extends Error {
  public readonly context: Record<string, unknown> | undefined;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "FabricationGuardError";
    this.context = context;
  }
}
