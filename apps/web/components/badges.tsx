const PROVENANCE_STYLE: Record<string, { label: string; fg: string; bg: string }> = {
  candidate_confirmed: { label: "Confirmed by Cai", fg: "var(--color-success)", bg: "var(--color-update-soft)" },
  agent_inferred: { label: "Agent inferred", fg: "var(--color-accent)", bg: "var(--color-action-soft)" },
  outcome_learned: { label: "Learned from outcomes", fg: "#5a4fb7", bg: "#e7e3fa" },
  needs_confirmation: { label: "Needs confirmation", fg: "var(--color-critical)", bg: "var(--color-critical-soft)" },
};

export function ProvenanceBadge({ source }: { source: string }) {
  const style = PROVENANCE_STYLE[source] ?? {
    label: source,
    fg: "var(--color-text-muted)",
    bg: "var(--color-surface-muted)",
  };
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color: style.fg, backgroundColor: style.bg }}
    >
      {style.label}
    </span>
  );
}

const PRIORITY_STYLE: Record<string, { fg: string; bg: string }> = {
  CRITICAL: { fg: "var(--color-critical)", bg: "var(--color-critical-soft)" },
  ACTION: { fg: "var(--color-action)", bg: "var(--color-action-soft)" },
  UPDATE: { fg: "var(--color-update)", bg: "var(--color-update-soft)" },
  DIGEST: { fg: "var(--color-digest)", bg: "var(--color-digest-soft)" },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const style = PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.DIGEST!;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: style.fg, backgroundColor: style.bg }}
    >
      {priority}
    </span>
  );
}

const STRENGTH_LABEL: Record<string, string> = {
  hard_constraint: "Hard constraint",
  strong_preference: "Strong preference",
  preference: "Preference",
  open: "Open",
};

export function StrengthBadge({ strength }: { strength: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-text)]">
      {STRENGTH_LABEL[strength] ?? strength}
    </span>
  );
}
