export function EmptyState({ label }: { label: string }) {
  return (
    <p className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
      {label}
    </p>
  );
}
