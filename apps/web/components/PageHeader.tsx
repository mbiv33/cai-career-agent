import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  trailing,
}: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+16px)] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text)]">{title}</h1>
          {subtitle ? (
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{subtitle}</p>
          ) : null}
        </div>
        {trailing}
      </div>
    </header>
  );
}
