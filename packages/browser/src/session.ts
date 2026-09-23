/**
 * Browser worker session (Technical Build Spec §9 — Browser Automation).
 *
 * A `PortalSession` owns one Playwright persistent context per portal
 * (`browser-profiles/<portal>`, gitignored) so cookies/local-storage survive
 * across brain runs — a portal that has already logged in once shouldn't
 * need to again.
 *
 * Two hard rules, straight from CLAUDE.md and spec §9/§16:
 *   - Never bypass CAPTCHA, MFA, or any other security control.
 *   - Human-paced interaction only — no instant fills/clicks that read as
 *     bot automation to the portal.
 *
 * `detectObstacle` is deliberately conservative: it only ever asks "is
 * something here that a human needs to handle", never attempts to solve
 * anything itself.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import type { Db } from "@cai/db";
import { createEscalation } from "@cai/core";

export type Obstacle = "captcha" | "mfa" | "login_required" | null;

/** Escalation `type` values this module raises — never solved, always escalated. */
export const OBSTACLE_ESCALATION_TYPE: Record<Exclude<Obstacle, null>, string> = {
  captcha: "CAPTCHA",
  mfa: "MFA",
  login_required: "LOGIN_REQUIRED",
};

export interface PortalSessionOptions {
  portal: string;
  /** Defaults to "browser-profiles" (gitignored at repo root). Override in tests. */
  baseProfileDir?: string;
  headless?: boolean;
}

function randomDelay(minMs: number, maxMs: number): number {
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Owns a persistent Playwright browser context for one portal. Human-paced
 * helpers (`typeSlow`, `clickWithDelay`) are the only sanctioned way agents
 * should interact with page elements — plain Playwright calls read as bot
 * traffic and are exactly what portals fingerprint against.
 */
export class PortalSession {
  private context: BrowserContext | undefined;

  constructor(private readonly options: PortalSessionOptions) {}

  get portal(): string {
    return this.options.portal;
  }

  get profileDir(): string {
    return path.join(this.options.baseProfileDir ?? "browser-profiles", this.options.portal);
  }

  async launch(): Promise<BrowserContext> {
    await mkdir(this.profileDir, { recursive: true });
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.options.headless ?? true,
    });
    return this.context;
  }

  async currentPage(): Promise<Page> {
    if (!this.context) {
      throw new Error(`PortalSession("${this.portal}") is not launched — call launch() first.`);
    }
    const existing = this.context.pages();
    return existing[0] ?? (await this.context.newPage());
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
  }

  /**
   * Types character-by-character with small randomized inter-key delays —
   * a portal watching for instant `fill()`-style input sees a plausible
   * human typing cadence instead.
   */
  async typeSlow(locator: Locator, text: string, opts: { minDelayMs?: number; maxDelayMs?: number } = {}): Promise<void> {
    const min = opts.minDelayMs ?? 25;
    const max = opts.maxDelayMs ?? 90;
    await locator.click();
    await locator.fill(""); // clear without triggering key-by-key deletion noise
    for (const char of text) {
      await locator.pressSequentially(char, { delay: 0 });
      await sleep(randomDelay(min, max));
    }
  }

  /** Clicks after a small randomized pause, then pauses again — avoids instant click bursts. */
  async clickWithDelay(locator: Locator, opts: { minDelayMs?: number; maxDelayMs?: number } = {}): Promise<void> {
    const min = opts.minDelayMs ?? 150;
    const max = opts.maxDelayMs ?? 450;
    await sleep(randomDelay(min, max));
    await locator.click();
    await sleep(randomDelay(min, max));
  }
}

// ---------------------------------------------------------------------------
// Obstacle detection — conservative DOM heuristics, never a solver
// ---------------------------------------------------------------------------

const CAPTCHA_TEXT_RE = /\bcaptcha\b|not a robot|verify (you are|you're) human/i;
const MFA_TEXT_RE =
  /\b(two[-\s]?factor|2fa|one[-\s]?time (passcode|code|password)|verification code|enter the code (we|sent)|authenticator app|security code)\b/i;
const LOGIN_TEXT_RE = /\b(sign in|log in|create an account) to (apply|continue)\b/i;

/**
 * Conservative, DOM-only heuristics. Never attempts to solve or bypass
 * anything — only classifies what's on the page so the caller can escalate.
 * Checked in order of severity: captcha, then mfa, then a plain login wall.
 */
export async function detectObstacle(page: Page): Promise<Obstacle> {
  const captchaIframe = await page
    .locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i]')
    .count();
  if (captchaIframe > 0) return "captcha";

  const captchaClass = await page.locator('[class*="captcha" i], [id*="captcha" i]').count();
  if (captchaClass > 0) return "captcha";

  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (CAPTCHA_TEXT_RE.test(bodyText)) return "captcha";
  if (MFA_TEXT_RE.test(bodyText)) return "mfa";

  const passwordField = await page.locator('input[type="password"]:visible').count();
  if (passwordField > 0 && LOGIN_TEXT_RE.test(bodyText)) return "login_required";

  return null;
}

export interface EscalateForObstacleInput {
  candidateId: string;
  applicationId?: string;
  jobId?: string;
  raisedBy: string;
  portal: string;
  pageUrl?: string;
}

/**
 * Creates a structured escalation for a detected obstacle and returns it.
 * Callers MUST stop all further interaction with the page once this
 * returns — this function never attempts to solve or work around the
 * obstacle itself (CLAUDE.md: never bypass CAPTCHA/MFA/security controls).
 */
export async function escalateForObstacle(db: Db, obstacle: Exclude<Obstacle, null>, input: EscalateForObstacleInput) {
  const type = OBSTACLE_ESCALATION_TYPE[obstacle];
  const humanLabel =
    obstacle === "captcha" ? "a CAPTCHA" : obstacle === "mfa" ? "a multi-factor authentication prompt" : "a login wall";

  return createEscalation(db, {
    candidateId: input.candidateId,
    applicationId: input.applicationId,
    jobId: input.jobId,
    type,
    priority: "CRITICAL",
    reason: `Portal "${input.portal}" presented ${humanLabel}${input.pageUrl ? ` at ${input.pageUrl}` : ""}.`,
    recommendedAction:
      obstacle === "captcha"
        ? "Complete the CAPTCHA yourself, then resolve this escalation to resume."
        : obstacle === "mfa"
          ? "Complete the MFA challenge (check your phone/email/authenticator), then resolve this escalation to resume."
          : "Log in to the portal, then resolve this escalation to resume.",
    requiredInput:
      obstacle === "login_required"
        ? "Confirm you've signed in to the portal."
        : "Confirm the challenge has been completed.",
    resumeImmediately: true,
    raisedBy: input.raisedBy,
  });
}
