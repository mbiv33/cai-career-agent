import { desc, eq } from "drizzle-orm";
import { jobEvaluations, jobs } from "@cai/db";
import { PIPELINE_STAGES, type JobStatus } from "@cai/core";
import { withDb } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { DbUnreachable } from "@/components/DbUnreachable";

export const dynamic = "force-dynamic";

function formatComp(min: number | null, max: number | null) {
  const fmt = (n: number) => `$${Math.round(n / 1000)}k`;
  if (min && max) return `${fmt(min)}–${fmt(max)}`;
  if (min) return `${fmt(min)}+`;
  if (max) return `Up to ${fmt(max)}`;
  return "Comp not listed";
}

async function loadPipeline() {
  return withDb(async (db) => {
    const allJobs = await db.select().from(jobs);

    const rejected = allJobs.filter((j) => j.status === "REJECTED");
    const reasoningByJob = new Map<string, string>();
    for (const job of rejected) {
      const [latest] = await db
        .select({ reasoning: jobEvaluations.reasoning })
        .from(jobEvaluations)
        .where(eq(jobEvaluations.jobId, job.id))
        .orderBy(desc(jobEvaluations.createdAt))
        .limit(1);
      if (latest) reasoningByJob.set(job.id, latest.reasoning);
    }

    return { allJobs, reasoningByJob };
  });
}

function JobCard({ job }: { job: { company: string; title: string; location: string | null; compensationMin: number | null; compensationMax: number | null; status: string } }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5">
      <p className="text-sm font-semibold text-[var(--color-text)]">{job.title}</p>
      <p className="text-sm text-[var(--color-text-muted)]">{job.company}</p>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-[var(--color-text-muted)]">{job.location ?? "Location unknown"}</span>
        <span className="font-medium text-[var(--color-accent)]">
          {formatComp(job.compensationMin, job.compensationMax)}
        </span>
      </div>
      <span className="mt-2 inline-block rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {job.status}
      </span>
    </div>
  );
}

export default async function PipelinePage() {
  const result = await loadPipeline();

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Pipeline" subtitle="Every opportunity, by stage" />
        <DbUnreachable detail={result.error} />
      </>
    );
  }

  const { allJobs, reasoningByJob } = result.data;
  const stageEntries = Object.entries(PIPELINE_STAGES).filter(([name]) => name !== "Rejected by Agent");
  const rejectedStatuses: readonly JobStatus[] = PIPELINE_STAGES["Rejected by Agent"] ?? [];
  const rejectedJobs = allJobs.filter((j) => rejectedStatuses.includes(j.status));

  return (
    <>
      <PageHeader title="Pipeline" subtitle="Every opportunity, by stage" />

      <section className="space-y-6 px-4 py-4">
        {stageEntries.map(([stageName, statuses]) => {
          const stageJobs = allJobs.filter((j) => statuses.includes(j.status));
          return (
            <div key={stageName}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                {stageName}
                <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
                  {stageJobs.length}
                </span>
              </h2>
              {stageJobs.length === 0 ? (
                <EmptyState label="No opportunities here yet." />
              ) : (
                <div className="space-y-2.5">
                  {stageJobs.map((job) => (
                    <JobCard key={job.id} job={job} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <details className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-[var(--color-text)]">
            <span>Rejected by Agent</span>
            <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
              {rejectedJobs.length}
            </span>
          </summary>
          <div className="space-y-3 border-t border-[var(--color-border)] px-4 py-3">
            {rejectedJobs.length === 0 ? (
              <EmptyState label="Nothing rejected yet." />
            ) : (
              rejectedJobs.map((job) => (
                <div key={job.id} className="rounded-xl bg-[var(--color-surface-muted)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text)]">
                    {job.title} <span className="font-normal text-[var(--color-text-muted)]">· {job.company}</span>
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Reason: {reasoningByJob.get(job.id) ?? "No reasoning recorded."}
                  </p>
                </div>
              ))
            )}
          </div>
        </details>
      </section>
    </>
  );
}
