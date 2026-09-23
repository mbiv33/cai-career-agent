export function DbUnreachable({ detail }: { detail?: string }) {
  return (
    <div className="mx-4 mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-center">
      <p className="text-2xl">🔌</p>
      <h2 className="mt-2 text-base font-semibold text-[var(--color-text)]">
        Can&apos;t reach the database
      </h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        This screen needs a live connection and couldn&apos;t get one. Check that
        Postgres is running and try again.
      </p>
      {detail ? (
        <p className="mt-3 truncate rounded-lg bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          {detail}
        </p>
      ) : null}
    </div>
  );
}
