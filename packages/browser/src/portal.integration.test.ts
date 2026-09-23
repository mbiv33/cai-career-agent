/**
 * Integration test: a real (headless) Playwright chromium session against a
 * tiny local static "portal" fixture, form-filling via @cai/knowledge
 * answer resolution against the seeded "Cai" candidate, and the submit
 * flow's dry-run + authority + obstacle gates.
 *
 * Runs as part of the normal `pnpm test` (no separate tag/config) — it only
 * needs a locally-installed chromium (`pnpm exec playwright install
 * chromium`, done once for this package) and headless: true throughout.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, escalations, jobs } from "@cai/db";
import { PortalSession, detectObstacle } from "./session.js";
import { fillApplicationForm, loadFormFillState } from "./form-fill.js";
import { submitApplication } from "./submit.js";
import {
  cleanupJobApplicationFixture,
  createJobApplicationFixture,
  db,
  getSeededCandidateId,
  seedVerifiedAnswer,
  type JobApplicationFixture,
} from "./test-db.js";
import { startFixtureServer, type FixtureServer } from "../test/fixtures/portal/server.js";

const RESUME_PATH = fileURLToPath(new URL("../test/fixtures/portal/resume.txt", import.meta.url));

describe("PortalSession + form-fill + submit — fixture portal integration", () => {
  let server: FixtureServer;
  let candidateId: string;
  const profileBase = path.join(tmpdir(), `cai-browser-test-${randomUUID()}`);
  const sessions: PortalSession[] = [];
  const fixtures: JobApplicationFixture[] = [];

  beforeAll(async () => {
    server = await startFixtureServer();
    candidateId = await getSeededCandidateId();
  });

  afterAll(async () => {
    for (const session of sessions) await session.close();
    await server.close();
    for (const fixture of fixtures) {
      await rm(path.join("var", "form-state", `${fixture.applicationId}.json`), { force: true });
      await cleanupJobApplicationFixture(fixture);
    }
    await rm(profileBase, { recursive: true, force: true });
  }, 30_000);

  async function openSession(portal: string): Promise<{ session: PortalSession; page: Awaited<ReturnType<PortalSession["currentPage"]>> }> {
    const session = new PortalSession({ portal, baseProfileDir: profileBase, headless: true });
    sessions.push(session);
    await session.launch();
    const page = await session.currentPage();
    return { session, page };
  }

  it(
    "fills known fields via resolveAnswer, follows the Continue flow to page 2, and escalates exactly once for the unresolved question",
    async () => {
      const fixture = await createJobApplicationFixture(candidateId, "form-fill");
      fixtures.push(fixture);

      await seedVerifiedAnswer({
        candidateId,
        applicationId: fixture.applicationId,
        questionPattern: "full name",
        answer: "Cai",
      });
      await seedVerifiedAnswer({
        candidateId,
        applicationId: fixture.applicationId,
        questionPattern: "email address",
        answer: "cai@example.com",
      });
      await seedVerifiedAnswer({
        candidateId,
        applicationId: fixture.applicationId,
        questionPattern: "phone number",
        answer: "555-123-4567",
      });
      await seedVerifiedAnswer({
        candidateId,
        applicationId: fixture.applicationId,
        questionPattern: "compensation expectations",
        answer: "$55,000",
      });

      const { session, page } = await openSession("fixture-test-portal");
      await page.goto(`${server.url}/page1.html`);

      const result = await fillApplicationForm({
        db,
        session,
        page,
        candidateId,
        applicationId: fixture.applicationId,
        jobId: fixture.jobId,
        raisedBy: "test",
        resumePath: RESUME_PATH,
      });

      // Followed the Continue button to page 2.
      expect(page.url()).toContain("page2.html");

      // Known fields resolved via verified answers / candidate facts, keyed by normalized question.
      expect(result.state.filled["full name"]).toBe("Cai");
      expect(result.state.filled["email address"]).toBe("cai@example.com");
      expect(result.state.filled["phone number"]).toBe("555-123-4567");
      expect(result.state.filled["what are your compensation expectations"]).toBe("$55,000");
      expect(result.state.filled["are you legally authorized to work in the united states"]).toBe("Yes");
      expect(result.state.filled["upload resume"]).toBe(RESUME_PATH);

      // The one genuinely unknown question escalated — never guessed.
      expect(result.state.pending).toEqual(["What is your desired start date?"]);
      expect(result.escalationId).toBeTruthy();
      expect(result.obstacle).toBeUndefined();

      const escalationRows = await db.select().from(escalations).where(eq(escalations.applicationId, fixture.applicationId));
      expect(escalationRows).toHaveLength(1);
      expect(escalationRows[0]?.type).toBe("APPLICATION_QUESTION");
      expect(escalationRows[0]?.requiredInput).toContain("desired start date");
      expect(escalationRows[0]?.resumeImmediately).toBe(true);

      // State persisted to var/form-state/<applicationId>.json (resume support).
      const persisted = await loadFormFillState(fixture.applicationId);
      expect(persisted?.pending).toEqual(["What is your desired start date?"]);
      expect(persisted?.escalationId).toBe(result.escalationId);

      // Re-running against the same (still on page 2) session does not create a second escalation for the same pending set.
      const secondPass = await fillApplicationForm({
        db,
        session,
        page,
        candidateId,
        applicationId: fixture.applicationId,
        jobId: fixture.jobId,
        raisedBy: "test",
        resumePath: RESUME_PATH,
      });
      expect(secondPass.escalationId).toBe(result.escalationId);
      const escalationRowsAfterResume = await db
        .select()
        .from(escalations)
        .where(eq(escalations.applicationId, fixture.applicationId));
      expect(escalationRowsAfterResume).toHaveLength(1);

      // --- submit: dry run stops before clicking Submit / before any navigation or DB write ---
      const dryRun = await submitApplication({
        db,
        session,
        page,
        candidateId,
        applicationId: fixture.applicationId,
        jobId: fixture.jobId,
        raisedBy: "test",
        dryRun: true,
      });
      expect(dryRun.outcome).toBe("dry_run");
      expect(page.url()).toContain("page2.html"); // did not navigate away
      expect(await page.locator("#confirmation").isHidden()).toBe(true); // did not click Submit

      const [jobAfterDryRun] = await db.select().from(jobs).where(eq(jobs.id, fixture.jobId));
      expect(jobAfterDryRun?.status).toBe("APPLYING"); // untouched
      const [appAfterDryRun] = await db.select().from(applications).where(eq(applications.id, fixture.applicationId));
      expect(appAfterDryRun?.status).toBe("IN_PROGRESS"); // untouched

      // --- submit: the real thing ---
      const submitted = await submitApplication({
        db,
        session,
        page,
        candidateId,
        applicationId: fixture.applicationId,
        jobId: fixture.jobId,
        raisedBy: "test",
      });
      expect(submitted.outcome).toBe("submitted");
      expect(await page.locator("#confirmation").isVisible()).toBe(true);

      const [jobAfterSubmit] = await db.select().from(jobs).where(eq(jobs.id, fixture.jobId));
      expect(jobAfterSubmit?.status).toBe("SUBMITTED");
      const [appAfterSubmit] = await db.select().from(applications).where(eq(applications.id, fixture.applicationId));
      expect(appAfterSubmit?.status).toBe("SUBMITTED");
      expect(appAfterSubmit?.submittedAt).toBeTruthy();
    },
    45_000,
  );

  it(
    "detectObstacle finds a CAPTCHA and fillApplicationForm escalates + hard-stops instead of touching the form",
    async () => {
      const fixture = await createJobApplicationFixture(candidateId, "captcha");
      fixtures.push(fixture);

      const { session, page } = await openSession("fixture-test-portal-captcha");
      await page.goto(`${server.url}/captcha.html`);

      const obstacle = await detectObstacle(page);
      expect(obstacle).toBe("captcha");

      const result = await fillApplicationForm({
        db,
        session,
        page,
        candidateId,
        applicationId: fixture.applicationId,
        jobId: fixture.jobId,
        raisedBy: "test",
      });

      expect(result.obstacle).toBe("captcha");
      expect(result.escalationId).toBeTruthy();
      expect(result.state.filled).toEqual({}); // never touched any form field
      expect(result.state.pending).toEqual([]); // stopped before extracting/collecting anything

      const escalationRows = await db.select().from(escalations).where(eq(escalations.applicationId, fixture.applicationId));
      expect(escalationRows).toHaveLength(1);
      expect(escalationRows[0]?.type).toBe("CAPTCHA");
      expect(escalationRows[0]?.priority).toBe("CRITICAL");
      expect(escalationRows[0]?.resumeImmediately).toBe(true);
    },
    30_000,
  );
});
