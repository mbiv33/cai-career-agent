import { desc } from "drizzle-orm";
import { auditEvents } from "@cai/db";
import { withDb } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { DbUnreachable } from "@/components/DbUnreachable";

export const dynamic = "force-dynamic";

async function loadActivity() {
  return withDb(async (db) => {
    return db.select().from(auditEvents).orderBy(desc(auditEvents.timestamp)).limit(300);
  });
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function dayLabel(d: Date) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const key = dayKey(d);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(d);
}

function timeOf(d: Date) {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export default async function ActivityPage() {
  const result = await loadActivity();

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Activity" subtitle="Complete chronological audit trail" />
        <DbUnreachable detail={result.error} />
      </>
    );
  }

  const events = result.data;

  const groups: { label: string; items: typeof events }[] = [];
  for (const event of events) {
    const ts = new Date(event.timestamp);
    const label = dayLabel(ts);
    const group = groups[groups.length - 1];
    if (group && group.label === label) {
      group.items.push(event);
    } else {
      groups.push({ label, items: [event] });
    }
  }

  return (
    <>
      <PageHeader title="Activity" subtitle="Complete chronological audit trail" />

      <section className="px-4 py-4">
        {groups.length === 0 ? (
          <EmptyState label="No activity recorded yet." />
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.label}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  {group.label}
                </h2>
                <ol className="space-y-3 border-l border-[var(--color-border)] pl-4">
                  {group.items.map((event) => (
                    <li key={event.id} className="relative">
                      <span
                        className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full"
                        style={{ backgroundColor: "var(--color-accent)" }}
                      />
                      <p className="text-sm text-[var(--color-text)]">
                        <span className="mr-2 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">
                          {timeOf(new Date(event.timestamp))}
                        </span>
                        — {event.action}
                      </p>
                      {event.reason ? (
                        <p className="mt-0.5 pl-[3.2rem] text-xs text-[var(--color-text-muted)]">
                          Reason: {event.reason}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
