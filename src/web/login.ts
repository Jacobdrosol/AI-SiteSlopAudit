import { promises as fs } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

export interface LoginOptions {
  loginUrl: string;
  email?: string;
  password?: string;
  emailSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  /** URL substring (or regex) that indicates a successful login. */
  successUrl?: string;
  /** Selector that indicates a successful login (e.g. a dashboard element). */
  successSelector?: string;
  /** Where to write the Playwright storage state. */
  outFile: string;
  /** Milliseconds to wait after submitting. */
  settleMs?: number;
  headless?: boolean;
}

export interface LoginResult {
  storageStatePath: string;
  finalUrl: string;
  success: boolean;
  detail: string;
}

async function waitForUrlMatch(page: Page, re: RegExp, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (re.test(page.url())) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function isSuccess(page: Page, options: LoginOptions): Promise<boolean> {
  if (options.successSelector) {
    try {
      await page.waitForSelector(options.successSelector, { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
  if (options.successUrl) {
    return waitForUrlMatch(page, new RegExp(options.successUrl), 12000);
  }
  // Default heuristic: settle, then we are considered logged in if we are no
  // longer sitting on a URL that looks like a login page.
  await page.waitForTimeout(options.settleMs ?? 3000);
  return !/login/i.test(page.url());
}

export async function loginAndSaveState(
  options: LoginOptions,
): Promise<LoginResult> {
  const emailSelector = options.emailSelector ?? "#email";
  const passwordSelector = options.passwordSelector ?? "#password";
  const submitSelector = options.submitSelector ?? 'button[type="submit"]';

  const browser: Browser = await chromium.launch({ headless: options.headless ?? true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(options.loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    if (!options.email || !options.password) {
      // No credentials: capture whatever session exists (e.g. for SSO flows).
      await fs.mkdir(path.dirname(options.outFile), { recursive: true });
      await context.storageState({ path: options.outFile });
      return {
        storageStatePath: options.outFile,
        finalUrl: page.url(),
        success: false,
        detail: "no credentials provided; saved current (unauthenticated) state",
      };
    }

    await page.waitForSelector(emailSelector, { timeout: 15000 });
    // Give SPAs a moment to hydrate their form handlers before interacting.
    await page.waitForTimeout(500);
    await page.fill(emailSelector, options.email);
    await page.waitForTimeout(150);
    await page.fill(passwordSelector, options.password);
    await page.waitForTimeout(150);
    await page.click(submitSelector).catch(async () => {
      await page.press(passwordSelector, "Enter");
    });

    const success = await isSuccess(page, options);
    await fs.mkdir(path.dirname(options.outFile), { recursive: true });
    await context.storageState({ path: options.outFile });
    return {
      storageStatePath: options.outFile,
      finalUrl: page.url(),
      success,
      detail: success
        ? `logged in, now at ${page.url()}`
        : `could not confirm login; still at ${page.url()}`,
    };
  } finally {
    await browser.close();
  }
}
