/**
 * Cai Career Agent — canonical data model (Technical Build Spec §5).
 * The database is the source of truth; LLM context is never the system of record.
 *
 * Contract spine: parallel tracks build against these tables and the enums in
 * @cai/core. Schema changes land on main via their own PR before feature work
 * depends on them.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Authority model (PRD §8). Mirrored as a TS type in @cai/core. */
export const authorityLevel = pgEnum("authority_level", [
  "AUTO",
  "AUTO_REPORT",
  "ASK_BEFORE_ACTION",
  "HUMAN_REQUIRED",
  "PROHIBITED",
]);

/** Opportunity state machine (spec §8). Transitions enforced in @cai/core. */
export const jobStatus = pgEnum("job_status", [
  "DISCOVERED",
  "NORMALIZED",
  "QUALIFYING",
  "REJECTED",
  "QUALIFIED",
  "RESEARCHED",
  "PREPARING",
  "READY",
  "APPLYING",
  "ESCALATED",
  "SUBMITTED",
  "MONITORING",
  "EMPLOYER_RESPONSE",
  "INTERVIEW",
  "OFFER",
  "CLOSED",
]);

/** Learning vs. policy separation (PRD §7). */
export const knowledgeKind = pgEnum("knowledge_kind", [
  "FACT",
  "PREFERENCE",
  "INFERENCE",
  "HYPOTHESIS",
  "POLICY",
]);

/** Provenance for candidate facts and preferences (PRD §5.5). */
export const provenance = pgEnum("provenance", [
  "candidate_confirmed",
  "agent_inferred",
  "outcome_learned",
  "needs_confirmation",
]);

export const escalationStatus = pgEnum("escalation_status", [
  "OPEN",
  "RESOLVED",
  "EXPIRED",
  "CANCELLED",
]);

export const escalationPriority = pgEnum("escalation_priority", [
  "CRITICAL",
  "ACTION",
  "UPDATE",
  "DIGEST",
]);

export const communicationDirection = pgEnum("communication_direction", [
  "INBOUND",
  "OUTBOUND",
]);

/** Email classification taxonomy (spec §11). */
export const communicationClass = pgEnum("communication_class", [
  "confirmation",
  "rejection",
  "recruiter_outreach",
  "interview_request",
  "assessment_request",
  "information_request",
  "offer",
  "automated_update",
  "unknown",
]);

export const applicationStatus = pgEnum("application_status", [
  "DRAFT",
  "IN_PROGRESS",
  "BLOCKED",
  "SUBMITTED",
  "CONFIRMED",
  "WITHDRAWN",
  "CLOSED",
]);

export const strategyProposalStatus = pgEnum("strategy_proposal_status", [
  "PROPOSED",
  "ACCEPTED",
  "REJECTED",
  "SUPERSEDED",
]);

export const taskStatus = pgEnum("task_status", [
  "OPEN",
  "DONE",
  "SKIPPED",
]);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("candidate"), // candidate | admin
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const candidateProfiles = pgTable("candidate_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  displayName: text("display_name").notNull(),
  headline: text("headline"),
  location: text("location"),
  phone: text("phone"),
  /** The dedicated job-search email the agent operates (sends as the candidate). */
  agentEmail: text("agent_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Canonical candidate record, independent of generated résumés (FR-1, spec §5.1). */
export const candidateFacts = pgTable(
  "candidate_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
    category: text("category").notNull(), // contact | education | employment | athletic | skill | accomplishment | certification | reference | answer | goal
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    sourceType: provenance("source_type").notNull(),
    sourceReference: text("source_reference"),
    confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull().default("1.00"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("candidate_facts_candidate_idx").on(t.candidateId, t.category)],
);

/** Spec §5.2 — an inferred preference must never silently become a hard constraint. */
export const preferences = pgTable(
  "preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
    type: text("type").notNull(), // work_environment | compensation | geography | schedule | industry | role | travel ...
    value: jsonb("value").notNull(),
    strength: text("strength").notNull(), // hard_constraint | strong_preference | preference | open
    source: provenance("source").notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull().default("1.00"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("preferences_candidate_idx").on(t.candidateId, t.type)],
);

export const careerGoals = pgTable("career_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
  title: text("title").notNull(),
  description: text("description"),
  horizon: text("horizon"), // immediate | 1yr | 3yr | long_term
  source: provenance("source").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const searchStrategies = pgTable("search_strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
  name: text("name").notNull(),
  /** Saved searches, source list, semantic expansion terms, weightings. */
  config: jsonb("config").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

/** Normalized Job object (FR-3, spec §5.3). */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalJobId: text("external_job_id"),
    company: text("company").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    compensationMin: integer("compensation_min"),
    compensationMax: integer("compensation_max"),
    employmentType: text("employment_type"),
    schedule: text("schedule"),
    travel: text("travel"),
    workEnvironment: text("work_environment"),
    responsibilities: jsonb("responsibilities"),
    minimumRequirements: jsonb("minimum_requirements"),
    preferredRequirements: jsonb("preferred_requirements"),
    physicalRequirements: jsonb("physical_requirements"),
    careerPath: text("career_path"),
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    applicationUrl: text("application_url"),
    postingDate: timestamp("posting_date", { withTimezone: true }),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
    status: jobStatus("status").notNull().default("DISCOVERED"),
    /** Stable hash of company+title+location for cross-posting dedup. */
    dedupeKey: text("dedupe_key").notNull(),
  },
  (t) => [
    uniqueIndex("jobs_dedupe_idx").on(t.dedupeKey),
    index("jobs_status_idx").on(t.status),
  ],
);

/** Posting state over time so changes/removals are auditable (spec §5.4). */
export const jobSnapshots = pgTable(
  "job_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    rawContent: jsonb("raw_content").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_snapshots_job_idx").on(t.jobId)],
);

/** Qualification decision with stored reasoning (FR-4, spec §5.5). */
export const jobEvaluations = pgTable(
  "job_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
    hardConstraintResult: jsonb("hard_constraint_result").notNull(),
    qualificationResult: jsonb("qualification_result").notNull(),
    careerFitResult: jsonb("career_fit_result").notNull(),
    preferenceFitResult: jsonb("preference_fit_result").notNull(),
    decision: text("decision").notNull(), // qualified | rejected
    reasoning: text("reasoning").notNull(),
    evidence: jsonb("evidence"),
    rulesApplied: jsonb("rules_applied"),
    modelVersion: text("model_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_evaluations_job_idx").on(t.jobId)],
);

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
  kind: text("kind").notNull(), // resume | cover_letter | supporting | other
  title: text("title").notNull(),
  /** Version lineage: null for originals, parent id for tailored versions. */
  parentDocumentId: uuid("parent_document_id"),
  storagePath: text("storage_path").notNull(),
  contentText: text("content_text"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
    status: applicationStatus("status").notNull().default("DRAFT"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    resumeDocumentId: uuid("resume_document_id").references(() => documents.id),
    coverLetterDocumentId: uuid("cover_letter_document_id").references(() => documents.id),
    applicationAccount: text("application_account"),
    confirmationReference: text("confirmation_reference"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("applications_job_idx").on(t.jobId), index("applications_status_idx").on(t.status)],
);

/** Reusable verified answer memory (spec §10). Resolution order:
 * verified stored answer → candidate facts → authorized derivation → escalate. */
export const applicationAnswers = pgTable(
  "application_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
    applicationId: uuid("application_id").references(() => applications.id),
    questionPattern: text("question_pattern").notNull(),
    questionRaw: text("question_raw"),
    answer: jsonb("answer").notNull(),
    source: provenance("source").notNull(),
    verified: boolean("verified").notNull().default(false),
    authorityLevel: authorityLevel("authority_level").notNull().default("ASK_BEFORE_ACTION"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_answers_candidate_idx").on(t.candidateId)],
);

// ---------------------------------------------------------------------------
// Communications & scheduling
// ---------------------------------------------------------------------------

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  role: text("role"), // recruiter | hiring_manager | hr | other
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const communications = pgTable(
  "communications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
    applicationId: uuid("application_id").references(() => applications.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    direction: communicationDirection("direction").notNull(),
    channel: text("channel").notNull().default("email"), // email | portal_message | phone | sms
    classification: communicationClass("classification"),
    externalMessageId: text("external_message_id"),
    threadId: text("thread_id"),
    subject: text("subject"),
    body: text("body"),
    sentByAgent: boolean("sent_by_agent").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** Inbound mail is stored immediately; classification happens at the next brain run. */
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("communications_application_idx").on(t.applicationId),
    index("communications_unprocessed_idx").on(t.processedAt),
    uniqueIndex("communications_external_idx").on(t.externalMessageId),
  ],
);

export const interviews = pgTable("interviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes"),
  kind: text("kind"), // phone_screen | video | onsite | assessment
  location: text("location"),
  calendarEventId: text("calendar_event_id"),
  prepNotes: text("prep_notes"),
  debriefNotes: text("debrief_notes"),
  outcome: text("outcome"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Cai's outstanding action items (surfaced on Home + Needs You). */
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
  applicationId: uuid("application_id").references(() => applications.id),
  title: text("title").notNull(),
  detail: text("detail"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: taskStatus("status").notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// HITL, audit, learning
// ---------------------------------------------------------------------------

/** Structured escalation (spec §5.7, §12) — context, not just a chat prompt. */
export const escalations = pgTable(
  "escalations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
    applicationId: uuid("application_id").references(() => applications.id),
    jobId: uuid("job_id").references(() => jobs.id),
    type: text("type").notNull(), // APPLICATION_QUESTION | CAPTCHA | MFA | ASSESSMENT | INTERVIEW_CONFIRM | STRATEGY_CHANGE | ...
    priority: escalationPriority("priority").notNull().default("ACTION"),
    reason: text("reason").notNull(),
    recommendedAction: text("recommended_action"),
    requiredInput: text("required_input").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }),
    consequenceOfNoAction: text("consequence_of_no_action"),
    status: escalationStatus("status").notNull().default("OPEN"),
    resolution: jsonb("resolution"),
    /** When true, resolving immediately resumes the blocked workflow instead of waiting for the next run. */
    resumeImmediately: boolean("resume_immediately").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("escalations_status_idx").on(t.status, t.priority)],
);

/** Every consequential agent action (FR-9). */
export const agentActions = pgTable(
  "agent_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent: text("agent").notNull(), // discovery | qualification | research | application | communication | pipeline | coaching | strategy | manager
    actionType: text("action_type").notNull(),
    authority: authorityLevel("authority").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    summary: text("summary").notNull(),
    detail: jsonb("detail"),
    runId: text("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_actions_run_idx").on(t.runId)],
);

/** Observation → Hypothesis → StrategyProposal → confirmation → policy (spec §14). */
export const strategyProposals = pgTable("strategy_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
  kind: knowledgeKind("kind").notNull(),
  observation: text("observation").notNull(),
  hypothesis: text("hypothesis"),
  proposal: text("proposal"),
  evidence: jsonb("evidence"),
  status: strategyProposalStatus("status").notNull().default("PROPOSED"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Campaign outcomes feeding analytics (spec §15). */
export const outcomes = pgTable("outcomes", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
  applicationId: uuid("application_id").references(() => applications.id),
  metric: text("metric").notNull(),
  value: jsonb("value").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only (spec §5.8). No update/delete path exists in @cai/core. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: text("actor").notNull(), // agent name | "candidate" | "system"
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    reason: text("reason"),
    evidence: jsonb("evidence"),
    policyReference: text("policy_reference"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
    index("audit_events_time_idx").on(t.timestamp),
  ],
);

/** Encrypted portal credential vault (Stage 2). Values are AES-256-GCM
 * ciphertext — plaintext never touches the database or model prompts. */
export const portalCredentials = pgTable("portal_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull().references(() => candidateProfiles.id),
  portal: text("portal").notNull(), // linkedin | indeed | workday:<tenant> | greenhouse | ...
  username: text("username").notNull(),
  secretCiphertext: text("secret_ciphertext").notNull(),
  browserProfileDir: text("browser_profile_dir"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
