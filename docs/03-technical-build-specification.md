# Cai Career Agent — Technical Build Specification

## 1. Build Goal

Implement an autonomous career-management application that can discover, qualify, prepare, submit, monitor, follow up, report, coach, and refine a candidate’s job-search campaign while escalating only actions that require human participation or authorization.

Core loop:

**AUTOMATE → ESCALATE → REPORT → COACH → REFINE**

## 2. System Architecture

```text
                    ┌──────────────┐
                    │ Web / Mobile │
                    └──────┬───────┘
                           │
                    Agent API Layer
                           │
       ┌───────────────────┼──────────────────┐
       │                   │                  │
 Career Agent        Workflow Engine     HITL Engine
       │                   │                  │
       └──────────────┬────┴──────────────────┘
                      │
                 PostgreSQL
                      │
 ┌───────────┬────────┼─────────┬─────────────┐
 │           │        │         │             │
Search    Browser   Email    Calendar     Documents
Agents    Agent     Agent     Agent         Agent
```

## 3. Recommended Stack

- **Frontend:** Next.js / React / TypeScript
- **Backend:** TypeScript or Python service layer
- **Database:** PostgreSQL
- **Queue:** Redis + BullMQ or equivalent durable job queue
- **AI:** OpenAI Responses/Agents APIs
- **Browser automation:** Playwright with computer-use fallback where appropriate
- **Authentication:** OAuth/OIDC
- **Object storage:** S3-compatible storage
- **Email:** Gmail initially
- **Calendar:** Google Calendar initially
- **Documents:** Google Drive plus internal object storage

The database is the source of truth. LLM conversational context is not the system of record.

## 4. External Connections

### Required for V1

1. OpenAI API
2. PostgreSQL database
3. Browser automation environment
4. Gmail OAuth
5. Google Calendar OAuth
6. Google Drive OAuth
7. Durable background worker/queue

### Optional/Expansion

- Additional email providers
- Additional calendars
- Additional cloud-storage providers
- Job-source APIs
- Recruiting/CRM systems
- SMS/push notification providers

## 5. Core Data Model

Primary entities:

```text
User
CandidateProfile
CandidateFact
Preference
CareerGoal
SearchStrategy
Job
JobSnapshot
JobEvaluation
Application
ApplicationAnswer
Document
Communication
Contact
Interview
Task
Escalation
AgentAction
StrategyProposal
Outcome
AuditEvent
```

### 5.1 CandidateFact

Minimum fields:

```text
id
candidate_id
category
key
value
source_type
source_reference
confidence
verified_at
created_at
updated_at
```

### 5.2 Preference

Example:

```json
{
  "type": "work_environment",
  "value": "active_field_work",
  "strength": "strong_preference",
  "source": "candidate_confirmed",
  "confidence": 1.0
}
```

An inferred preference must not automatically become a hard constraint.

### 5.3 Job

Store normalized current state plus source identity.

Minimum fields:

```text
id
external_job_id
company
title
location
compensation_min
compensation_max
employment_type
schedule
travel
work_environment
responsibilities
minimum_requirements
preferred_requirements
physical_requirements
career_path
source
source_url
application_url
posting_date
discovered_at
status
```

### 5.4 JobSnapshot

Preserve posting state over time so changes or removals can be audited.

### 5.5 JobEvaluation

```text
job_id
candidate_id
hard_constraint_result
qualification_result
career_fit_result
preference_fit_result
decision
reasoning
evidence
rules_applied
model_version
created_at
```

### 5.6 Application

```text
id
job_id
candidate_id
status
started_at
submitted_at
resume_document_id
cover_letter_document_id
application_account
confirmation_reference
next_action_at
```

### 5.7 Escalation

```text
id
candidate_id
application_id
type
priority
reason
recommended_action
required_input
deadline
status
created_at
resolved_at
```

### 5.8 AuditEvent

Audit events should be append-only.

```text
id
actor
event_type
entity_type
entity_id
action
reason
evidence
policy_reference
timestamp
```

## 6. Agent Structure

Use specialized agents/services rather than one monolithic prompt.

### Career Manager

Primary orchestrator and user-facing persona.

Responsibilities:

- Determine next workflow
- Coordinate specialized agents
- Generate candidate briefings
- Manage coaching interactions
- Surface escalations
- Present strategy proposals

### Discovery Agent

Responsibilities:

- Execute saved searches
- Generate semantic/adjacent searches
- Crawl/query authorized sources
- Normalize discoveries
- Deduplicate opportunities

### Qualification Agent

Responsibilities:

- Apply hard constraints
- Evaluate minimum qualifications
- Assess preferences
- Evaluate career-direction fit
- Record decision and reasoning
- Reject unsuitable opportunities without requiring candidate review

### Research Agent

Responsibilities:

- Employer research
- Role clarification
- Compensation context
- Career-path context
- Resolve uncertain qualification facts when possible

### Application Agent

Responsibilities:

- Select appropriate résumé baseline
- Tailor materials
- Generate authorized answers
- Navigate application
- Upload documents
- Submit within authority
- Create escalation when blocked

### Communication Agent

Responsibilities:

- Monitor candidate inbox
- Classify employer communications
- Match messages to applications
- Send authorized routine responses
- Create escalations
- Execute follow-up schedule

### Pipeline Agent

Responsibilities:

- Maintain application state
- Track deadlines
- Detect stalled applications
- Trigger follow-ups
- Reconcile email/browser activity with pipeline

### Coaching Agent

Responsibilities:

- Daily priorities
- Interview preparation
- Candidate accountability
- Decision support
- Post-interview debrief
- Candidate-facing persona

### Strategy Agent

Responsibilities:

- Analyze campaign outcomes
- Detect patterns
- Generate hypotheses
- Recommend search/application/communication changes
- Create StrategyProposal records

## 7. Persona Layer

Persona must be separated from deterministic workflow and qualification logic.

Suggested persistent persona configuration:

```text
SOUL.md
```

Define:

- Relationship to Cai
- Communication style
- Accountability philosophy
- Coaching approach
- Appropriate encouragement
- Appropriate directness
- When to challenge avoidance
- How to present failures/rejections
- How to celebrate progress
- Boundaries on autonomous decision-making

Persona must consume factual campaign state rather than inventing motivational narratives.

## 8. Workflow Engine

Every opportunity should progress through a state machine.

```text
DISCOVERED
↓
NORMALIZED
↓
QUALIFYING
├── REJECTED
└── QUALIFIED
      ↓
   RESEARCHED
      ↓
   PREPARING
      ↓
   READY
      ↓
   APPLYING
      ├── ESCALATED
      └── SUBMITTED
             ↓
          MONITORING
             ↓
       EMPLOYER_RESPONSE
             ↓
          INTERVIEW
             ↓
            OFFER
             ↓
            CLOSED
```

Transitions must generate audit events.

## 9. Browser Automation

Browser worker requirements:

- Persistent sessions where appropriate
- Secure credential handling
- Form detection
- Form population
- File upload
- Multi-page workflow support
- Screenshot/state capture for recovery
- Interruption/resume
- Portal status checks
- Error classification

Never bypass CAPTCHA or security controls.

Trigger escalation for:

- CAPTCHA
- MFA
- Unsupported authentication
- Candidate attestation
- Unknown factual question
- Assessment
- Video response
- Material commitment outside policy

## 10. Application Answer System

Maintain reusable verified answers.

Every answer should include:

```text
question_pattern
answer
source
verified
last_used
authority_level
```

Answer resolution order:

```text
Verified stored answer
→ Candidate facts
→ Authorized deterministic derivation
→ Escalate
```

Never guess a factual application answer.

## 11. Communications Engine

Ingest email events and classify:

```text
confirmation
rejection
recruiter_outreach
interview_request
assessment_request
information_request
offer
automated_update
unknown
```

Map messages to Application where possible.

Routine authorized communications may send automatically.

All sent messages are stored and reported.

Unknown/substantive communications create escalation.

## 12. HITL Engine

Escalations should include structured context rather than simply opening a chat.

Example:

```json
{
  "type": "APPLICATION_QUESTION",
  "priority": "ACTION",
  "reason": "Employer asks for desired compensation and no approved range exists.",
  "recommendation": "$55,000–$65,000 based on current strategy.",
  "required_input": "Confirm range or provide another answer."
}
```

Resolved answers should optionally become reusable candidate knowledge after confirmation.

## 13. Reporting Engine

Reporting must include both actions and decisions.

Candidate should be able to inspect:

```text
Discovered
Qualified
Rejected
Applied
Waiting
Responses
Interviews
Offers
Agent actions
Communications
Escalations
Strategy changes
```

Rejected-job reporting should aggregate reasons while allowing drill-down.

Example:

```text
Rejected Opportunities — 34

17 — Compensation below threshold
8 — Predominantly desk-based
5 — Experience mismatch
3 — Poor career trajectory
1 — Travel requirement
```

The system should flag possible over-filtering.

Example:

> Eight opportunities were rejected based on inferred desk-time rather than explicit posting language. Review this filtering rule?

## 14. Refinement Engine

Maintain separate objects for:

```text
FACT
PREFERENCE
INFERENCE
HYPOTHESIS
POLICY
```

Required strategy-change flow:

```text
Observation
↓
Hypothesis
↓
StrategyProposal
↓
Candidate review/confirmation
↓
Policy update
```

Examples of changes requiring confirmation:

- Minimum compensation
- Geographic expansion
- Geographic contraction
- Excluding a job category
- Prioritizing a materially different career path
- Communication tone
- Follow-up frequency
- Travel tolerance
- Desk/field-work threshold

## 15. Analytics

Calculate at minimum:

```text
jobs_discovered
qualification_rate
agent_rejection_rate
applications_submitted
application_response_rate
interview_rate
offer_rate
candidate_time_required
automation_rate
escalation_rate
follow_up_response_rate
performance_by_role_family
performance_by_resume_version
performance_by_source
performance_by_employer_type
```

Analytics should feed Strategy Agent hypotheses.

## 16. Security

Requirements:

- OAuth rather than stored passwords where available
- Encrypt sensitive credentials/tokens
- Least-privilege scopes
- Explicit authorization policies
- Audit every external action
- Separate candidate facts from generated content
- Configurable data retention
- No credential exposure to model prompts unless strictly necessary
- No fabricated application information
- No circumvention of access controls

## 17. MVP Build Sequence

### Phase 1 — Brain

Build:

- Candidate profile
- Database
- Preferences
- Career strategy
- Job ingestion
- Normalization
- Fit engine
- Audit system
- Dashboard

**Milestone:** system can discover, evaluate, reject/qualify, explain, and report.

### Phase 2 — Hands

Build:

- Browser automation
- Application generation
- Document management
- Application-answer memory
- Application submission
- HITL interruption/resume

**Milestone:** system can complete and submit standard applications.

### Phase 3 — Communications

Build:

- Gmail integration
- Calendar integration
- Employer-response classification
- Follow-up automation
- Interview workflow

**Milestone:** system manages the post-application lifecycle.

### Phase 4 — Manager

Build:

- Persona/SOUL
- Coaching
- Daily briefings
- Accountability
- Interview preparation
- Candidate action management

**Milestone:** system functions as Cai’s active career manager.

### Phase 5 — Learning

Build:

- Outcome analytics
- Strategy hypotheses
- Preference confirmation
- Search optimization
- Communication experimentation
- Self-audit of filtering decisions

**Milestone:** campaign strategy improves from observed outcomes without unauthorized policy drift.

## 18. Acceptance Principle

At every stage, the product should satisfy:

> **Automate the work. Escalate what requires Cai. Report everything. Coach the human. Refine the strategy.**
