import { desc, eq, isNotNull, notInArray } from "drizzle-orm";
import { agentActions, applications, escalations, jobs, tasks } from "@cai/db";
import { withDb } from "@/lib/db";
import { getPrimaryCandidate } from "@/lib/candidate";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { DbUnreachable } from "@/components/DbUnreachable";

export const dynamic = "force-dynamic";

async function loadHome() {
  return withDb(async (db) => {
    const candidate = await getPrimaryCandidate(db);

    const [discovered, qualified, rejected, submittedApps, openEscalations, openTasks, recentActions, myOpenTasks] =
      await Promise.all([
        db.select({ id: jobs.id }).from(jobs),
        db.select({ id: jobs.id }).from(jobs).where(notInArray(jobs.status, ["DISCOVERED", "NORMALIZED", "QUALIFYING", "REJECTED"])),
        db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, "REJECTED")),
        db.select({ id: applications.id }).from(applications).where(isNotNull(applications.submittedAt)),
        db.select({ id: escalations.id }).from(escalations).where(eq(escalations.status, "OPEN")),
        db.select({ id: tasks.id }).from(tasks).where(eq(tasks.status, "OPEN")),
        db.select().from(agentActions).orderBy(desc(agentActions.createdAt)).limit(6),
        db.select().from(tasks).where(eq(tasks.status, "OPEN")).orderBy(desc(tasks.createdAt)).limit(10),
      ]);

    return {
      candidateName: candidate?.displayName ?? "Cai",
      counts: {
        discovered: discovered.length,
        qualified: qualified.length,
        rejected: rejected.length,
        submitted: submittedApps.length,
        openEscalations: openEscalations.length,
        openTasks: openTasks.length,
      },
      recentActions,
      myOpenTasks,
    };
  });
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p className="text-2xl font-semibold tabular-nums text-[var(--color-text)]">{value}</p>
      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{label}</p>
    </div>
  );
}

function timeOf(d: Date) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d);
}

export default async function HomePage() {
  const result = await loadHome();

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Home" subtitle="Command center" />
        <DbUnreachable detail={result.error} />
      </>
    );
  }

  const { candidateName, counts, recentActions, myOpenTasks } = result.data;

  return (
    <>
      <PageHeader title={`Hi, ${candidateName}`} subtitle="Here's where the search stands." />

      <section className="px-4 pt-4">
        <div className="grid grid-cols-3 gap-2.5">
          <StatTile label="Discovered" value={counts.discovered} />
          <StatTile label="Qualified" value={counts.qualified} />
          <StatTile label="Rejected by agent" value={counts.rejected} />
          <StatTile label="Applications submitted" value={counts.submitted} />
          <StatTile label="Open escalations" value={counts.openEscalations} />
          <StatTile label="Open tasks" value={counts.openTasks} />
        </div>
      </section>

      <section className="mt-6 px-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Current agent activity</h2>
        <div className="mt-2 divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {recentActions.length === 0 ? (
            <div className="p-4">
              <EmptyState label="No agent activity recorded yet." />
            </div>
          ) : (
            recentActions.map((a) => (
              <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 shrink-0 text-xs tabular-nums text-[var(--color-text-muted)]">
                  {timeOf(new Date(a.createdAt))}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-[var(--color-text)]">{a.summary}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {a.agent} · {a.actionType}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-6 px-4 pb-6">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Your outstanding tasks</h2>
        <div className="mt-2 divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {myOpenTasks.length === 0 ? (
            <div className="p-4">
              <EmptyState label="Nothing outstanding — you're caught up." />
            </div>
          ) : (
            myOpenTasks.map((t) => (
              <div key={t.id} className="px-4 py-3">
                <p className="text-sm font-medium text-[var(--color-text)]">{t.title}</p>
                {t.detail ? (
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{t.detail}</p>
                ) : null}
                {t.dueAt ? (
                  <p className="mt-1 text-xs text-[var(--color-accent)]">
                    Due {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(t.dueAt))}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
