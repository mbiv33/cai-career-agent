# Cai Career Agent — Product Requirements Document (PRD)

## 1. Product

**Working name:** Cai Career Agent

## 2. Product Objective

Reduce the candidate’s job-search workload while increasing application quality, consistency, follow-through, and learning.

The candidate should spend his time primarily on activities that **actually require him**.

The system operates on five functions:

**AUTOMATE → ESCALATE → REPORT → COACH → REFINE**

## 3. Primary User

Initial implementation: Cai.

Candidate-specific characteristics must live in configuration and structured data rather than application code so the product can ultimately support additional candidates.

## 4. Experience Principles

The application should answer four questions immediately:

- What is the agent doing?
- What has happened?
- What needs me?
- What are we learning?

A job that fails established fit criteria should not be surfaced as a recommendation requiring Cai to evaluate it. It should be rejected by the agent, recorded, and remain visible in reporting/audit history.

**Report is not the same as Escalate.** Cai can inspect everything without being interrupted by everything.

## 5. Primary Navigation

**Home | Needs You | Activity | Pipeline | Career**

### 5.1 Home

The command center should display:

- Search activity
- Applications submitted
- Employer responses
- Interviews
- Upcoming actions
- Current agent activity
- Search performance
- Important observations
- Cai’s outstanding tasks

The Home screen is not primarily a job feed.

### 5.2 Needs You

Central human-in-the-loop queue.

Each escalation must contain:

- What happened
- Why Cai is needed
- Agent recommendation
- Required decision/action
- Deadline, if any
- Consequence of no action

Examples include:

- Approve or provide an application answer
- Complete an assessment
- Confirm an interview
- Authenticate an application portal
- Respond to a recruiter
- Review a proposed strategy change

### 5.3 Activity

Complete chronological audit trail.

Example:

```text
09:42 — Discovered MHC Operations Trainee
09:44 — Fit analysis passed
09:47 — Résumé tailored
09:53 — Application submitted
10:01 — Confirmation email received
```

Rejected opportunities remain visible:

```text
10:14 — Rejected XYZ Coordinator
Reason: Predominantly desk-based; conflicts with confirmed work-style preference.
```

### 5.4 Pipeline

Primary stages:

```text
Discovered
→ Qualified
→ Prepared
→ Applied
→ Employer Response
→ Interview
→ Offer
→ Closed
```

Jobs failing qualification move to:

```text
Rejected by Agent
```

They are retained rather than deleted.

### 5.5 Career

Contains the durable career strategy:

- Candidate profile
- Experience
- Education
- Skills
- Career objectives
- Compensation
- Geography
- Work environment
- Industry preferences
- Role preferences
- Hard constraints
- Soft preferences
- Career hypotheses
- Communication preferences
- Agent permissions

Every preference should have provenance:

- Candidate confirmed
- Agent inferred
- Outcome learned
- Needs confirmation

## 6. Functional Requirements

### FR-1 — Candidate Knowledge System

Maintain a canonical candidate record independent of generated résumés.

Store:

- Personal/contact information
- Education
- Employment history
- Athletic experience
- Skills
- Accomplishments
- Certifications
- References
- Standard application answers
- Career goals
- Preferences and constraints
- Supporting documents

Every fact requires provenance.

The system must never manufacture qualifications, experience, accomplishments, or application answers.

### FR-2 — Opportunity Discovery

Continuously discover opportunities from sources including:

- Employer career sites
- Search engines
- Job aggregators where technically and contractually permitted
- Government employment sources
- Staffing/recruiting firms
- Target employers
- Relevant professional networks

Discovery must expand beyond exact titles using semantic career matching.

### FR-3 — Job Normalization

Convert every posting into a common Job object containing, where available:

```text
company
title
location
compensation
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
application_url
posting_date
job_id
```

Cross-posted opportunities must be deduplicated.

### FR-4 — Qualification Engine

Evaluate every opportunity before recommendation or application.

#### Hard constraints

Failure causes automatic rejection and reporting.

#### Soft preferences

Contribute to fit analysis but do not necessarily disqualify.

#### Career strategy

Determine whether the opportunity reasonably advances the candidate’s confirmed career direction.

Store the reasoning behind every decision.

### FR-5 — Application Generation

Generate job-specific materials as needed:

- Résumé
- Cover letter
- Application responses
- Supporting materials

Maintain document and version history.

### FR-6 — Browser/Application Automation

The agent should be capable of:

- Navigating application systems
- Creating or accessing candidate accounts
- Populating forms
- Uploading documents
- Answering authorized questions
- Saving progress
- Submitting applications within its authority
- Interrupting and resuming workflows

CAPTCHA, MFA, or unsupported authentication should trigger escalation rather than circumvention.

### FR-7 — Communications

Connect a candidate email account.

The agent should:

- Read job-related email
- Classify messages
- Associate messages with opportunities/applications
- Draft replies
- Send authorized routine communications
- Escalate substantive communications when required
- Track response timing
- Follow up automatically within approved rules

### FR-8 — Calendar

The agent should:

- Read availability
- Identify scheduling conflicts
- Propose interview times
- Create confirmed events
- Add preparation blocks
- Trigger interview preparation workflows

### FR-9 — Reporting and Audit

Every consequential agent action creates an audit event.

No opportunity disappears because the agent rejected it.

Users should be able to inspect:

**What happened → Why → Evidence → Rule used → Agent action**

### FR-10 — Coaching

The persona layer receives structured campaign context.

Responsibilities include:

- Daily priorities
- Interview preparation
- Accountability
- Decision support
- Career-direction discussions
- Post-interview debrief
- Encouragement grounded in actual campaign performance

A persistent persona/SOUL layer may define the relationship and voice without controlling deterministic business logic.

### FR-11 — Refinement Engine

Periodically evaluate:

- Application-to-response rate
- Response-to-interview rate
- Interview-to-offer rate
- Performance by job category
- Performance by résumé version
- Compensation patterns
- Employer types
- Search-source quality
- Follow-up effectiveness
- Rejection reasons
- Candidate behavior

The system generates observations and hypotheses, then proposes material strategy changes for confirmation.

Example:

> Field-operations applications are receiving materially more employer interest than technician applications. Increase field-operations search weighting?

## 7. Learning vs. Policy

The system must distinguish:

- **Facts** — objectively known information
- **Preferences** — explicitly stated candidate preferences
- **Inferences** — agent observations
- **Hypotheses** — possible strategy improvements
- **Policies** — rules the agent is authorized to follow

An observation must not silently become a consequential policy.

Example:

```text
Observation
↓
Hypothesis
↓
Recommendation
↓
Candidate confirmation
↓
Policy update
```

## 8. Authority Model

Every action type receives an authorization level:

```text
AUTO
AUTO + REPORT
ASK BEFORE ACTION
HUMAN REQUIRED
PROHIBITED
```

Example defaults:

| Action | Authority |
|---|---|
| Reject obvious mismatch | AUTO + REPORT |
| Tailor résumé | AUTO |
| Submit normal application within policy | AUTO + REPORT |
| Routine follow-up | AUTO + REPORT |
| Change salary floor | ASK BEFORE ACTION |
| Materially change career direction | ASK BEFORE ACTION |
| Answer legal/background disclosure | HUMAN REQUIRED |
| Complete candidate assessment | HUMAN REQUIRED |
| Invent missing information | PROHIBITED |

Permissions must be configurable.

## 9. Notifications

Notifications should be classified as:

- **Critical** — immediate action required
- **Action** — candidate input required
- **Update** — meaningful development
- **Digest** — routine reporting

All underlying activity remains available regardless of whether a notification was generated.

## 10. Success Metrics

The North Star is not total applications submitted.

Primary outcome hierarchy:

1. Qualified employer responses
2. Interviews
3. Viable offers

Secondary measures:

- Candidate time required
- Automation rate
- Escalation rate
- Application quality
- Response rates by strategy
- Follow-up effectiveness
- Learning/refinement velocity
