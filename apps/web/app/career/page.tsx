import { and, eq } from "drizzle-orm";
import { candidateFacts, careerGoals, preferences } from "@cai/db";
import { withDb } from "@/lib/db";
import { getPrimaryCandidate } from "@/lib/candidate";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { DbUnreachable } from "@/components/DbUnreachable";
import { ProvenanceBadge, StrengthBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  contact: "Contact",
  education: "Education",
  employment: "Employment",
  athletic: "Athletic experience",
  skill: "Skills",
  accomplishment: "Accomplishments",
  certification: "Certifications",
  reference: "References",
  answer: "Standard answers",
  goal: "Goals",
};

function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(renderValue).join(", ");
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${titleCase(k)}: ${typeof v === "object" ? renderValue(v) : String(v)}`)
    .join(" · ");
}

async function loadCareer() {
  return withDb(async (db) => {
    const candidate = await getPrimaryCandidate(db);
    if (!candidate) {
      return { candidate: null, facts: [], prefs: [], goals: [] };
    }
    const [facts, prefs, goals] = await Promise.all([
      db.select().from(candidateFacts).where(eq(candidateFacts.candidateId, candidate.id)),
      db
        .select()
        .from(preferences)
        .where(and(eq(preferences.candidateId, candidate.id), eq(preferences.active, true))),
      db
        .select()
        .from(careerGoals)
        .where(and(eq(careerGoals.candidateId, candidate.id), eq(careerGoals.active, true))),
    ]);
    return { candidate, facts, prefs, goals };
  });
}

export default async function CareerPage() {
  const result = await loadCareer();

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Career" subtitle="Durable career strategy" />
        <DbUnreachable detail={result.error} />
      </>
    );
  }

  const { candidate, facts, prefs, goals } = result.data;

  if (!candidate) {
    return (
      <>
        <PageHeader title="Career" subtitle="Durable career strategy" />
        <div className="px-4 py-4">
          <EmptyState label="No candidate profile found yet." />
        </div>
      </>
    );
  }

  const factsByCategory = new Map<string, typeof facts>();
  for (const fact of facts) {
    const list = factsByCategory.get(fact.category) ?? [];
    list.push(fact);
    factsByCategory.set(fact.category, list);
  }

  return (
    <>
      <PageHeader title="Career" subtitle={candidate.headline ?? "Candidate profile"} />

      <section className="px-4 py-4">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-base font-semibold text-[var(--color-text)]">{candidate.displayName}</p>
          {candidate.location ? (
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{candidate.location}</p>
          ) : null}
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">Read-only — the agent updates this record.</p>
        </div>
      </section>

      <section className="px-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Career goals</h2>
        {goals.length === 0 ? (
          <EmptyState label="No career goals recorded yet." />
        ) : (
          <div className="space-y-2.5">
            {goals.map((goal) => (
              <div key={goal.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{goal.title}</p>
                  <ProvenanceBadge source={goal.source} />
                </div>
                {goal.description ? (
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">{goal.description}</p>
                ) : null}
                {goal.horizon ? (
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">Horizon: {titleCase(goal.horizon)}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 px-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Preferences &amp; constraints</h2>
        {prefs.length === 0 ? (
          <EmptyState label="No preferences recorded yet." />
        ) : (
          <div className="space-y-2.5">
            {prefs.map((pref) => (
              <div key={pref.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{titleCase(pref.type)}</p>
                  <StrengthBadge strength={pref.strength} />
                </div>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">{renderValue(pref.value)}</p>
                <div className="mt-2">
                  <ProvenanceBadge source={pref.source} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 px-4 pb-6">
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Candidate facts</h2>
        {factsByCategory.size === 0 ? (
          <EmptyState label="No facts on file yet." />
        ) : (
          <div className="space-y-4">
            {Array.from(factsByCategory.entries()).map(([category, categoryFacts]) => (
              <div key={category}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  {CATEGORY_LABEL[category] ?? titleCase(category)}
                </h3>
                <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                  {categoryFacts.map((fact) => (
                    <div key={fact.id} className="px-3.5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-[var(--color-text)]">{titleCase(fact.key)}</p>
                        <ProvenanceBadge source={fact.sourceType} />
                      </div>
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{renderValue(fact.value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
