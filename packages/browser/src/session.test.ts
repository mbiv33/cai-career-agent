/**
 * detectObstacle + typeSlow/clickWithDelay against inline HTML (via
 * `page.setContent`) — no fixture server needed for these. A single shared
 * headless browser is launched for the whole file to keep this fast.
 */
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { detectObstacle } from "./session.js";

describe("detectObstacle (DOM heuristics, no solving)", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it("returns null for a plain form page", async () => {
    await page.setContent('<form><input name="email" /></form>');
    expect(await detectObstacle(page)).toBeNull();
    await page.close();
  });

  it("detects a reCAPTCHA iframe", async () => {
    await page.setContent('<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>');
    expect(await detectObstacle(page)).toBe("captcha");
    await page.close();
  });

  it("detects a captcha-classed element even with no iframe", async () => {
    await page.setContent('<div class="g-recaptcha-container">verify</div>');
    expect(await detectObstacle(page)).toBe("captcha");
    await page.close();
  });

  it("detects captcha by page text", async () => {
    await page.setContent("<p>Please confirm you're not a robot before continuing.</p>");
    expect(await detectObstacle(page)).toBe("captcha");
    await page.close();
  });

  it("detects an MFA / verification-code prompt", async () => {
    await page.setContent("<p>We sent a verification code to your phone. Enter it below.</p><input />");
    expect(await detectObstacle(page)).toBe("mfa");
    await page.close();
  });

  it("detects a two-factor authentication prompt", async () => {
    await page.setContent("<h1>Two-factor authentication</h1><p>Enter your authenticator app code.</p>");
    expect(await detectObstacle(page)).toBe("mfa");
    await page.close();
  });

  it("detects a login wall (password field + sign-in copy)", async () => {
    await page.setContent(
      '<p>Sign in to apply</p><form><input type="password" name="password" /></form>',
    );
    expect(await detectObstacle(page)).toBe("login_required");
    await page.close();
  });

  it("does not flag an ordinary password field with no login copy as an obstacle", async () => {
    // e.g. a "create a portal password" field on the application form itself — not a login wall.
    await page.setContent('<label>Choose a password</label><input type="password" name="newPassword" />');
    expect(await detectObstacle(page)).toBeNull();
    await page.close();
  });

  it("prioritizes captcha over an incidental mfa-like word", async () => {
    await page.setContent(
      '<div class="captcha-box"></div><p>Enter the verification code shown above the captcha.</p>',
    );
    expect(await detectObstacle(page)).toBe("captcha");
    await page.close();
  });
});

describe("PortalSession human-paced helpers", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it("typeSlow fills the input with the full text", async () => {
    await page.setContent('<input id="name" />');
    const { PortalSession } = await import("./session.js");
    const session = new PortalSession({ portal: "unit-test" });
    await session.typeSlow(page.locator("#name"), "Cai");
    expect(await page.locator("#name").inputValue()).toBe("Cai");
    await page.close();
  });

  it("clickWithDelay actually clicks the target", async () => {
    await page.setContent('<button id="btn" onclick="this.textContent = \'clicked\'">go</button>');
    const { PortalSession } = await import("./session.js");
    const session = new PortalSession({ portal: "unit-test" });
    await session.clickWithDelay(page.locator("#btn"), { minDelayMs: 1, maxDelayMs: 5 });
    expect(await page.locator("#btn").textContent()).toBe("clicked");
    await page.close();
  });
});
