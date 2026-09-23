/**
 * Seed fixture data so every track can develop against real-shaped rows:
 * a candidate (Cai) with confirmed facts/preferences, a search strategy,
 * and a spread of jobs across pipeline states — including an agent-rejected
 * job with reasoning, and an open escalation for the Needs You queue.
 *
 * Idempotent: wipes and re-inserts fixture rows (dev only — refuses to run
 * against a non-local database unless SEED_ALLOW_REMOTE=1).
 */
import { createHash } from "node:crypto";
import { createDb, schema } from "./index.js";
import {
  agentActions,
  applications,
  auditEvents,
  candidateFacts,
  candidateProfiles,
  escalations,
  jobEvaluations,
  jobs,
  preferences,
  searchStrategies,
  tasks,
  users,
} from "./schema.js";

const url = process.env.DATABASE_URL ?? "postgres://cai:cai_dev@localhost:5433/cai_career";
if (!/localhost|127\.0\.0\.1/.test(url) && process.env.SEED_ALLOW_REMOTE !== "1") {
  throw new Error("Refusing to seed a non-local database. Set SEED_ALLOW_REMOTE=1 to override.");
}

const db = createDb(url);

function dedupeKey(company: string, title: string, location: string) {
  return createHash("sha256").update(`${company}|${title}|${location}`.toLowerCase()).digest("hex");
}

async function main() {
  // Wipe in dependency order (dev fixture reset).
  await db.delete(schema.outcomes);
  await db.delete(schema.strategyProposals);
  await db.delete(schema.interviews);
  await db.delete(schema.communications);
  await db.delete(schema.contacts);
  await db.delete(schema.applicationAnswers);
  await db.delete(escalations);
  await db.delete(tasks);
  await db.delete(jobEvaluations);
  await db.delete(applications);
  await db.delete(schema.documents);
  await db.delete(schema.jobSnapshots);
  await db.delete(jobs);
  await db.delete(agentActions);
  await db.delete(auditEvents);
  await db.delete(schema.portalCredentials);
  await db.delete(searchStrategies);
  await db.delete(schema.careerGoals);
  await db.delete(preferences);
  await db.delete(candidateFacts);
  await db.delete(candidateProfiles);
  await db.delete(users);

  const [user] = await db
    .insert(users)
    .values({ email: "cai@example.com", name: "Cai", role: "candidate" })
    .returning();

  const [candidate] = await db
    .insert(candidateProfiles)
    .values({
      userId: user!.id,
      displayName: "Cai",
      headline: "Operations & field-work oriented early-career candidate",
      location: "Sample City, ST",
    })
    .returning();
  const candidateId = candidate!.id;

  await db.insert(candidateFacts).values([
    {
      candidateId,
      category: "education",
      key: "degree",
      value: { school: "State University", degree: "B.S.", field: "Kinesiology", year: 2024 },
      sourceType: "candidate_confirmed",
    },
    {
      candidateId,
      category: "athletic",
      key: "college_athletics",
      value: { sport: "Track & Field", level: "NCAA", years: 4 },
      sourceType: "candidate_confirmed",
    },
    {
      candidateId,
      category: "answer",
      key: "work_authorization",
      value: { question: "Are you authorized to work in the US?", answer: "Yes" },
      sourceType: "candidate_confirmed",
    },
  ]);

  await db.insert(preferences).values([
    {
      candidateId,
      type: "work_environment",
      value: { preference: "active_field_work" },
      strength: "strong_preference",
      source: "candidate_confirmed",
    },
    {
      candidateId,
      type: "compensation",
      value: { minimum: 50000 },
      strength: "hard_constraint",
      source: "candidate_confirmed",
    },
  ]);

  await db.insert(searchStrategies).values({
    candidateId,
    name: "Field operations — initial campaign",
    config: {
      queries: ["operations trainee", "field operations", "logistics coordinator"],
      sources: ["fixtures"],
      semanticExpansion: true,
    },
  });

  // Jobs across the pipeline.
  const jobRows = await db
    .insert(jobs)
    .values([
      {
        company: "MHC Industrial",
        title: "Operations Trainee",
        location: "Sample City, ST",
        compensationMin: 55000,
        compensationMax: 62000,
        workEnvironment: "field",
        source: "fixtures",
        applicationUrl: "https://example.com/mhc/apply",
        status: "QUALIFIED",
        dedupeKey: dedupeKey("MHC Industrial", "Operations Trainee", "Sample City, ST"),
      },
      {
        company: "XYZ Corp",
        title: "Office Coordinator",
        location: "Sample City, ST",
        compensationMin: 48000,
        compensationMax: 52000,
        workEnvironment: "desk",
        source: "fixtures",
        status: "REJECTED",
        dedupeKey: dedupeKey("XYZ Corp", "Office Coordinator", "Sample City, ST"),
      },
      {
        company: "Northline Logistics",
        title: "Field Operations Associate",
        location: "Sample City, ST",
        compensationMin: 58000,
        compensationMax: 65000,
        workEnvironment: "field",
        source: "fixtures",
        applicationUrl: "https://example.com/northline/apply",
        status: "APPLYING",
        dedupeKey: dedupeKey("Northline Logistics", "Field Operations Associate", "Sample City, ST"),
      },
    ])
    .returning();

  const [qualified, rejected, applying] = jobRows;

  await db.insert(jobEvaluations).values([
    {
      jobId: qualified!.id,
      candidateId,
      hardConstraintResult: { compensation: "pass" },
      qualificationResult: { minimumRequirements: "pass" },
      careerFitResult: { direction: "advances field-operations goal" },
      preferenceFitResult: { work_environment: "match" },
      decision: "qualified",
      reasoning: "Meets compensation floor; field-based role matches confirmed work-style preference.",
      rulesApplied: ["compensation_floor", "work_environment_preference"],
      modelVersion: "fixture",
    },
    {
      jobId: rejected!.id,
      candidateId,
      hardConstraintResult: { compensation: "fail: 48-52k below 50k floor midpoint" },
      qualificationResult: { minimumRequirements: "pass" },
      careerFitResult: { direction: "neutral" },
      preferenceFitResult: { work_environment: "conflict: predominantly desk-based" },
      decision: "rejected",
      reasoning:
        "Predominantly desk-based; conflicts with confirmed work-style preference. Compensation range straddles the floor.",
      rulesApplied: ["work_environment_preference", "compensation_floor"],
      modelVersion: "fixture",
    },
  ]);

  const [app] = await db
    .insert(applications)
    .values({
      jobId: applying!.id,
      candidateId,
      status: "BLOCKED",
      startedAt: new Date(),
    })
    .returning();

  const [esc] = await db.insert(escalations).values({
    candidateId,
    applicationId: app!.id,
    jobId: applying!.id,
    type: "APPLICATION_QUESTION",
    priority: "ACTION",
    reason: "Employer asks for desired compensation and no approved range exists.",
    recommendedAction: "$55,000–$65,000 based on current strategy.",
    requiredInput: "Confirm range or provide another answer.",
    consequenceOfNoAction: "Application remains incomplete; posting may close.",
    resumeImmediately: true,
  }).returning();

  await db.insert(tasks).values({
    candidateId,
    title: "Confirm compensation range for Northline application",
    detail: "The agent paused mid-application pending your answer in Needs You.",
  });

  await db.insert(auditEvents).values([
    {
      actor: "discovery",
      eventType: "job.discovered",
      entityType: "job",
      entityId: qualified!.id,
      action: "Discovered MHC Operations Trainee",
    },
    {
      actor: "qualification",
      eventType: "job.rejected",
      entityType: "job",
      entityId: rejected!.id,
      action: "Rejected XYZ Office Coordinator",
      reason: "Predominantly desk-based; conflicts with confirmed work-style preference.",
      policyReference: "work_environment_preference",
    },
    {
      actor: "application",
      eventType: "escalation.created",
      entityType: "escalation",
      entityId: esc!.id,
      action: "Escalated: Employer asks for desired compensation and no approved range exists.",
      reason: "Confirm range or provide another answer.",
    },
  ]);

  // Fixture agent activity so Home's "current agent activity" has data (PRD §4).
  await db.insert(agentActions).values([
    {
      agent: "discovery",
      actionType: "stage.completed",
      authority: "AUTO_REPORT",
      entityType: "job",
      entityId: qualified!.id,
      summary: "Discovery run: 3 postings ingested, 0 duplicates",
      runId: "run-fixture-0900",
    },
    {
      agent: "application",
      actionType: "application.paused",
      authority: "AUTO_REPORT",
      entityType: "application",
      entityId: app!.id,
      summary: "Paused Northline application pending compensation answer",
      runId: "run-fixture-0900",
    },
  ]);

  console.log("Seeded: 1 candidate, 3 jobs (QUALIFIED / REJECTED / APPLYING), 1 open escalation.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
