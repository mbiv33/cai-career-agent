import { asc, eq } from "drizzle-orm";
import { escalations, jobs } from "@cai/db";
import { withDb } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { DbUnreachable } from "@/components/DbUnreachable";
import { PriorityBadge } from "@/components/badges";
import { resolveEscalation } from "./actions";

export const dynamic = "force-dynamic";

async function loadEscalations() {
  return withDb(async (db) => {
    return db
      .select({
        id: escalations.id,
        type: escalations.type,
        priority: escalations.priority,
        reason: escalations.reason,
        recommendedAction: escalations.recommendedAction,
        requiredInput: escalations.requiredInput,
        deadline: escalations.deadline,
        consequenceOfNoAction: escalations.consequenceOfNoAction,
        createdAt: escalations.createdAt,
        jobCompany: jobs.company,
        jobTitle: jobs.title,
      })
      .from(escalations)
      .leftJoin(jobs, eq(escalations.jobId, jobs.id))
      .where(eq(escalations.status, "OPEN"))
      .orderBy(asc(escalations.priority), asc(escalations.deadline));
  });
}

function formatDeadline(d: Date | null) {
  if (!d) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

export default async function NeedsYouPage() {
  const result = await loadEscalations();

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Needs You" subtitle="Open items requiring your input" />
        <DbUnreachable detail={result.error} />
      </>
    );
  }

  const items = result.data;

  return (
    <>
      <PageHeader title="Needs You" subtitle={`${items.length} open item${items.length === 1 ? "" : "s"}`} />

      <section className="space-y-3 px-4 py-4">
        {items.length === 0 ? (
          <EmptyState label="Nothing needs you right now. The agent is handling the rest on its own." />
        ) : (
          items.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <PriorityBadge priority={item.priority} />
                {item.deadline ? (
                  <span className="text-xs font-medium text-[var(--color-critical)]">
                    Due {formatDeadline(item.deadline)}
                  </span>
                ) : null}
              </div>

              {item.jobCompany ? (
                <p className="mt-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  {item.jobCompany}
                  {item.jobTitle ? ` · ${item.jobTitle}` : ""}
                </p>
              ) : null}

              <h2 className="mt-1 text-base font-semibold text-[var(--color-text)]">{item.reason}</h2>

              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="text-xs font-medium text-[var(--color-text-muted)]">What Cai needs to do</dt>
                  <dd className="text-[var(--color-text)]">{item.requiredInput}</dd>
                </div>
                {item.recommendedAction ? (
                  <div>
                    <dt className="text-xs font-medium text-[var(--color-text-muted)]">Agent recommendation</dt>
                    <dd className="text-[var(--color-text)]">{item.recommendedAction}</dd>
                  </div>
                ) : null}
                {item.consequenceOfNoAction ? (
                  <div>
                    <dt className="text-xs font-medium text-[var(--color-text-muted)]">If nothing happens</dt>
                    <dd className="text-[var(--color-text)]">{item.consequenceOfNoAction}</dd>
                  </div>
                ) : null}
              </dl>

              <form action={resolveEscalation} className="mt-4 space-y-2">
                <input type="hidden" name="escalationId" value={item.id} />
                <label className="block text-xs font-medium text-[var(--color-text-muted)]" htmlFor={`answer-${item.id}`}>
                  Your answer
                </label>
                <textarea
                  id={`answer-${item.id}`}
                  name="answer"
                  required
                  rows={3}
                  placeholder="Type your answer or decision…"
                  className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                />
                <button
                  type="submit"
                  className="min-h-11 w-full rounded-xl bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-accent-contrast)] active:opacity-80"
                >
                  Resolve
                </button>
              </form>
            </article>
          ))
        )}
      </section>
    </>
  );
}
