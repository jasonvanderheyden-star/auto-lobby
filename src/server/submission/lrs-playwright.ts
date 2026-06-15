/**
 * lrs-playwright.ts
 *
 * Supervised Playwright automation for LRS (lobbycanada.gc.ca) MCR submission.
 *
 * NON-NEGOTIABLES (never change these):
 *   - Runs in HEADED mode — the user watches every step in a visible browser.
 *   - We NEVER store LRS credentials. The user types them manually at login AND
 *     again at the Certify modal. We only detect the success banner to confirm.
 *   - We NEVER auto-click the final Certify button. The user clicks it themselves.
 *
 * Run via: npm run lrs:submit
 * or:      TENANT_ID=xxx npx dotenv-cli -e .env.local -- npx tsx scripts/submit-to-lrs.ts
 */

import { chromium, type Page } from "playwright";
import type { LrsSubmissionPayload, SubmissionResult } from "./types";

const LRS_BASE = "https://lobbycanada.gc.ca";
const LOGIN_URL = `${LRS_BASE}/app/secure/ocl/lrs/do/lgncrdntls`;

/** How long (ms) to wait for the user to sign in at the login screen. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

/** How long (ms) to wait for the user to enter credentials at the Certify modal and click Certify. */
const CERTIFY_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * Submit a batch of certified MCRs to the LRS.
 *
 * Opens a headed Chromium window. The user must:
 *   1. Log in to LRS at the login screen (username → Continue → password → Sign in).
 *   2. Enter their username + password again at the Certify modal for EACH MCR,
 *      then click the Certify button themselves.
 *
 * Returns a SubmissionResult for each payload. On the first failure the batch stops.
 */
export async function submitBatchToLrs(
  payloads: LrsSubmissionPayload[],
  onStatus: (msg: string) => void,
): Promise<SubmissionResult[]> {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const page = await browser.newPage();
  const results: SubmissionResult[] = [];

  try {
    // ── Step 1: Navigate to login page, wait for user to authenticate ──────────
    onStatus(
      "Opening LRS in browser. Please sign in with your LRS username and password to continue.",
    );
    await page.goto(LOGIN_URL);

    // The LRS login flow is two-step: username → Continue → password → Sign in.
    // We wait until the URL moves past the lgncrdntls login path.
    await page.waitForURL(
      (url) =>
        url.toString().includes("/lrs/do/") && !url.toString().includes("lgncrdntls"),
      { timeout: LOGIN_TIMEOUT_MS },
    );
    onStatus("Signed in successfully. Starting MCR submission batch...");

    // ── Step 2: Submit each MCR in sequence ────────────────────────────────────
    for (const payload of payloads) {
      const result = await submitOneMcr(page, payload, onStatus);
      results.push(result);
      if (result.status === "failed") {
        onStatus(
          `Submission failed for draft MCR ${payload.draftMcrId}: ${result.error ?? "unknown error"}. Stopping batch to avoid partial filings.`,
        );
        break;
      }
    }
  } finally {
    // Brief pause so the user can see the final state before the browser closes.
    await page.waitForTimeout(4_000);
    await browser.close();
  }

  return results;
}

/**
 * Submit a single MCR. Navigates back to the dashboard for each MCR so the
 * flow is repeatable without relying on browser state from the previous filing.
 */
async function submitOneMcr(
  page: Page,
  payload: LrsSubmissionPayload,
  onStatus: (msg: string) => void,
): Promise<SubmissionResult> {
  const { draftMcrId, communicationDate, dpohs, clientName } = payload;

  try {
    onStatus(`Filing MCR for ${communicationDate} (draft ${draftMcrId})...`);

    // ── Navigate to registrant dashboard ──────────────────────────────────────
    await page.goto(LOGIN_URL);
    await page.waitForURL(
      (url) =>
        url.toString().includes("/lrs/do/") && !url.toString().includes("lgncrdntls"),
      { timeout: 30_000 },
    );

    // ── Find the client section and click "Add new" ────────────────────────────
    // The dashboard shows: "Communication reports: View all | Add new"
    // under the client's name section.
    const clientHeading = page.locator("text=" + clientName).first();
    await clientHeading.waitFor({ timeout: 15_000 });

    // Walk up to the section container, then find "Add new" within it.
    // LRS renders each client as a block with a heading + action links.
    const addNewLink = page
      .locator("text=" + clientName)
      .locator("xpath=ancestor::*[self::div or self::section or self::tr][1]")
      .locator("a, button")
      .filter({ hasText: "Add new" })
      .first();

    // Fallback: if the xpath approach doesn't find it, scan all "Add new" links
    // and pick the one closest to the client name in the DOM.
    let addNewFound = false;
    try {
      await addNewLink.waitFor({ timeout: 5_000 });
      addNewFound = true;
    } catch {
      // xpath didn't resolve — fall through to fallback
    }

    if (addNewFound) {
      await addNewLink.click();
    } else {
      // Fallback: click the first "Add new" link on the page (works when there's
      // only one client, which is true for Phase 4).
      onStatus("Using fallback 'Add new' selector — verify the correct client is selected.");
      await page.locator("a:has-text('Add new'), button:has-text('Add new')").first().click();
    }

    // ── Pre-flight confirmations ───────────────────────────────────────────────
    onStatus("Confirming registration information is current...");
    await page.waitForSelector("input[type='checkbox']", { timeout: 15_000 });
    const checkboxes = await page.locator("input[type='checkbox']").all();
    for (const cb of checkboxes) {
      if (!(await cb.isChecked())) {
        await cb.check();
      }
    }
    await page
      .locator("input[value='Continue'], button:has-text('Continue')")
      .first()
      .click();

    // ── Communication date modal ───────────────────────────────────────────────
    onStatus(`Entering communication date: ${communicationDate}...`);
    // LRS date input typically uses a YYYY-MM-DD placeholder or three separate fields.
    // Try a single input first; fall back to separate year/month/day inputs.
    try {
      await page.waitForSelector("input[placeholder='YYYY-MM-DD']", { timeout: 8_000 });
      await page.fill("input[placeholder='YYYY-MM-DD']", communicationDate);
    } catch {
      // Separate date parts: try year/month/day text inputs
      const [year, month, day] = communicationDate.split("-");
      await page.waitForSelector(
        "input[name*='year'], input[id*='year'], input[placeholder*='YYYY']",
        { timeout: 8_000 },
      );
      await page
        .locator("input[name*='year'], input[id*='year'], input[placeholder*='YYYY']")
        .first()
        .fill(year ?? "");
      await page
        .locator("input[name*='month'], input[id*='month'], input[placeholder*='MM']")
        .first()
        .fill(month ?? "");
      await page
        .locator("input[name*='day'], input[id*='day'], input[placeholder*='DD']")
        .first()
        .fill(day ?? "");
    }
    await page.locator("button:has-text('Save'), input[value='Save']").first().click();

    // ── DPOH modal(s) ──────────────────────────────────────────────────────────
    onStatus(`Entering ${dpohs.length} designated public office holder(s)...`);
    await page.waitForSelector(
      "text=Designated public office holders, text=designated public office holders",
      { timeout: 15_000 },
    );

    for (let i = 0; i < dpohs.length; i++) {
      const dpoh = dpohs[i]!;

      // For the first DPOH, click the "Add" button in the DPOH section.
      // Subsequent DPOHs: clicking "Save and Add Another" leaves an empty form open.
      if (i === 0) {
        await page
          .locator(
            "button:has-text('Add'), a:has-text('Add'), button:has-text('Add DPOH'), input[value='Add']",
          )
          .first()
          .click();
      }

      // Wait for the DPOH form to be visible
      await page.waitForSelector("text=First name, text=Given name", { timeout: 10_000 });

      // First name — try multiple selector strategies for robustness
      await fillField(page, ["First name", "Given name"], dpoh.firstName);

      // Last name
      await fillField(page, ["Last name", "Family name", "Surname"], dpoh.lastName);

      // Position / title
      if (dpoh.positionTitle) {
        await fillField(page, ["Position", "Title", "Job title"], dpoh.positionTitle);
      }

      // Branch / unit (optional)
      if (dpoh.branchUnit) {
        await fillField(page, ["Branch", "Unit", "Department"], dpoh.branchUnit);
      }

      // Government institution dropdown
      if (dpoh.governmentInstitution) {
        // Try exact label match first, then partial
        try {
          await page
            .locator("select")
            .first()
            .selectOption({ label: dpoh.governmentInstitution });
        } catch {
          // Partial match: strip the acronym and try by institution name only
          const nameOnly = dpoh.governmentInstitution.replace(/\s*\([^)]+\)$/, "");
          await page.locator("select").first().selectOption({ label: nameOnly });
        }
      }

      const isLast = i === dpohs.length - 1;
      if (isLast) {
        await page.locator("button:has-text('Save'), input[value='Save']").first().click();
      } else {
        await page
          .locator(
            "button:has-text('Save and Add Another'), button:has-text('Add another'), input[value='Save and Add Another']",
          )
          .first()
          .click();
      }

      // Brief pause to allow the form to reset between DPOHs
      await page.waitForTimeout(500);
    }

    // ── Subject matter details ─────────────────────────────────────────────────
    onStatus("Selecting subject matter details...");
    await page.waitForSelector(
      "text=Subject matter details, text=subject matter details",
      { timeout: 15_000 },
    );
    await page
      .locator(
        "button:has-text('Add'), button:has-text('Add/Edit'), a:has-text('Add'), input[value='Add']",
      )
      .last()
      .click();

    await page.waitForSelector(
      "text=Subject matter details of the communication, text=subject matter",
      { timeout: 10_000 },
    );

    // Phase 4: check ALL checkboxes (every registration subject applies).
    // In Phase 5 this will be refined to match by OCL code.
    const subjectCheckboxes = await page.locator("input[type='checkbox']").all();
    for (const cb of subjectCheckboxes) {
      if (!(await cb.isChecked())) {
        await cb.check();
      }
    }
    await page.locator("button:has-text('Save'), input[value='Save']").first().click();

    // ── Review page → Certify ──────────────────────────────────────────────────
    onStatus("Review complete. Clicking Certify to open the certification dialog...");
    await page.waitForSelector(
      "button:has-text('Certify'), input[value='Certify'], a:has-text('Certify')",
      { timeout: 15_000 },
    );
    await page
      .locator("button:has-text('Certify'), input[value='Certify'], a:has-text('Certify')")
      .first()
      .click();

    // Some LRS versions show a "single DPOH confirmation" dialog before the Certify modal.
    try {
      await page.waitForSelector("text=Continue to certify", { timeout: 3_000 });
      await page.locator("button:has-text('Continue to certify')").click();
    } catch {
      // No intermediate confirmation — proceed directly to Certify modal.
    }

    // ── Certify modal — user must enter credentials and click Certify ──────────
    onStatus(
      "ACTION REQUIRED: The Certify dialog is open in the browser. " +
        "Please enter your LRS username and password, check the attestation checkbox, " +
        "and click the Certify button. We are waiting for the confirmation banner...",
    );

    // Ensure the attestation checkbox (if present) is pre-checked for convenience.
    // The user still must enter credentials and click Certify themselves.
    try {
      await page.waitForSelector("text=Account username, text=Username", { timeout: 8_000 });
      const attestation = page.locator("input[type='checkbox']").first();
      const isChecked = await attestation.isChecked().catch(() => false);
      if (!isChecked) {
        await attestation.check().catch(() => {
          // If we can't auto-check it, the user will check it manually — that's fine.
        });
      }
    } catch {
      // Certify modal has different structure — user handles it fully.
    }

    // Wait for the success banner. The user clicks Certify; we detect the outcome.
    // Timeout: 5 minutes to accommodate deliberate user actions.
    await page.waitForSelector(
      "text=has been successfully certified, text=successfully certified",
      { timeout: CERTIFY_TIMEOUT_MS },
    );

    // ── Extract communication number ───────────────────────────────────────────
    const bannerEl = page.locator(
      "text=has been successfully certified, text=successfully certified",
    );
    const bannerText = await bannerEl.first().textContent();
    // Communication numbers appear as "383902-645607" — six digits, dash, six digits.
    const commNumMatch = bannerText?.match(/(\d{6}-\d{6})/);
    const communicationNumber = commNumMatch?.[1];

    onStatus(
      `Filed successfully. Communication number: ${communicationNumber ?? "not found in banner — check LRS manually"}.`,
    );

    return {
      draftMcrId,
      status: "submitted",
      communicationNumber,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { draftMcrId, status: "failed", error };
  }
}

/**
 * Fill a form field by finding a label that contains one of the given label texts,
 * then filling the associated input.
 *
 * Strategy (in order):
 *   1. label:has-text(text) → associated input[for] or child input
 *   2. input[placeholder*=text] / input[aria-label*=text]
 *   3. element with text content followed by sibling/descendant input
 */
async function fillField(page: Page, labelTexts: string[], value: string): Promise<void> {
  for (const labelText of labelTexts) {
    try {
      // Strategy 1: Playwright's getByLabel — resolves for/aria-labelledby/aria-label
      const input = page.getByLabel(labelText, { exact: false });
      if ((await input.count()) > 0) {
        await input.first().fill(value);
        return;
      }
    } catch {
      // continue
    }

    try {
      // Strategy 2: label element → adjacent or wrapped input
      const labelEl = page.locator(`label:has-text("${labelText}")`);
      if ((await labelEl.count()) > 0) {
        const input = labelEl.locator("input").first();
        if ((await input.count()) > 0) {
          await input.fill(value);
          return;
        }
        // Try for= reference
        const forAttr = await labelEl.first().getAttribute("for");
        if (forAttr) {
          await page.locator(`#${forAttr}`).fill(value);
          return;
        }
      }
    } catch {
      // continue
    }
  }

  // If all strategies fail, log and skip — don't throw, let the LRS form validation
  // surface the missing field to the user who is watching the browser.
  console.warn(
    `[lrs-playwright] Could not locate input for labels: ${labelTexts.join(", ")}. Value "${value}" not filled — please enter manually.`,
  );
}
