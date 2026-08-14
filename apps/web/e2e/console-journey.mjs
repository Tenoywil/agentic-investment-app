/**
 * The partner journey, in a real browser, against the real stack.
 *
 * The unit and HTTP suites can both pass while the product does not work. The
 * case that proves it: "List a product" wrote a `product_listings` row, the
 * route test asserted the row came back, and no investor could ever see the
 * result — the assertion that would have caught it is the one nobody had
 * written, because it spans two surfaces. So this drives the console as an
 * operator and the marketplace as an investor, in one run, and checks that what
 * one does the other sees.
 *
 * It is deliberately not part of `bun test`: it needs two servers, a seeded
 * database and a browser, and a check that cannot run is worse than no check
 * because it looks like one. Run it by hand when the console changes.
 *
 *   # 1. a migrated, seeded local database, then in three terminals:
 *   cd apps/api && bun run dev
 *   cd apps/web && API_ORIGIN=http://localhost:3001 NEXT_PUBLIC_DATA_MODE=live bun run dev
 *   cd apps/api && bun run mint-session          # prints the two cookies
 *   OPERATOR_COOKIE=… INVESTOR_COOKIE=… node apps/web/e2e/console-journey.mjs
 *
 * `API_ORIGIN` rather than `NEXT_PUBLIC_API_URL`: the browser must reach the API
 * through the same-origin rewrite, or the session cookie is third-party, is
 * never sent, and every authenticated call 401s. See apps/web/lib/config.ts —
 * that failure has happened in production once already.
 *
 * Chromium comes from PLAYWRIGHT_BROWSERS_PATH when set, and `playwright-core`
 * downloads no browsers of its own.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const OPERATOR = process.env.OPERATOR_COOKIE;
const INVESTOR = process.env.INVESTOR_COOKIE;
const WEB = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3000';
if (!OPERATOR || !INVESTOR) {
  console.error(
    'Set OPERATOR_COOKIE and INVESTOR_COOKIE — see `bun run mint-session` in apps/api.',
  );
  process.exit(2);
}

/** The installed Chromium, wherever this machine keeps it. */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    const dir = readdirSync(root).find((d) => d.startsWith('chromium-'));
    if (dir) return join(root, dir, 'chrome-linux', 'chrome');
  }
  return undefined; // let playwright-core look where it normally would
}

const NAME = `E2E Fund ${Date.now()}`;
const escaped = NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch({ executablePath: chromiumPath() });

async function signedIn(cookie) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addCookies([
    {
      name: 'ccn.session_token',
      value: decodeURIComponent(cookie),
      domain: 'localhost',
      path: '/',
    },
  ]);
  return context.newPage();
}

/** A first-time operator gets the guided tour; it sits over everything. */
async function dismissTour(page) {
  for (let i = 0; i < 12; i++) {
    if (!(await page.locator('.driver-popover').count())) return;
    const close = page.locator('.driver-popover-close-btn');
    if (await close.count())
      await close
        .first()
        .click({ force: true })
        .catch(() => {});
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

const op = await signedIn(OPERATOR);
const inv = await signedIn(INVESTOR);

// ---- the operator lists a product, with the fields a deal card renders ----
await op.goto(`${WEB}/institutions`, { waitUntil: 'networkidle' });
await dismissTour(op);
await op.getByRole('tab', { name: /products/i }).click();
await op
  .getByRole('button', { name: /list a product/i })
  .first()
  .click();
await op.waitForSelector('dialog[open]');

const form = op.locator('dialog[open]');
await form.getByRole('textbox').first().fill(NAME);
await form.locator('select').first().selectOption('bond');
await form.getByPlaceholder('SREF').fill('E2EF');
await form.locator('select').nth(1).selectOption('JMD');
await form.getByPlaceholder('5000').fill('7500');
await form.getByPlaceholder('8.25%').fill('9.5%');
await form.getByPlaceholder('Coupon').fill('Coupon');
await form.getByPlaceholder('5 years').fill('7 years');
await form.locator('select').nth(2).selectOption('high');
await form.getByPlaceholder('Jamaica').fill('Jamaica');
await form.locator('textarea').fill('Listed by the browser journey.');
await form.getByRole('button', { name: /^list it$/i }).click();
await op.waitForSelector('dialog[open]', { state: 'detached', timeout: 10_000 }).catch(() => {});

const catalogue = op.locator('[data-tour="institution-products"]');
let listed = await catalogue.innerText();
check(listed.includes(NAME), 'the new listing appears in the console catalogue');
check(listed.includes('J$7,500'), 'the console shows the minimum the operator typed, not US$0');
check(
  /high/i.test(listed.split(NAME)[1]?.slice(0, 200) ?? ''),
  'the risk band shows, not "Not rated"',
);

// ---- an investor sees it ----
await inv.goto(`${WEB}/opportunities`, { waitUntil: 'networkidle' });
await dismissTour(inv);
await inv.waitForTimeout(1500);
let marketplace = await inv.locator('body').innerText();
check(marketplace.includes(NAME), 'an investor sees the listing in the marketplace');
check(marketplace.includes('9.5%'), 'the investor sees the headline figure the firm listed');

// ---- pausing takes it off the shelf ----
await op.reload({ waitUntil: 'networkidle' });
await dismissTour(op);
await op.getByRole('tab', { name: /products/i }).click();
await op.getByRole('switch', { name: new RegExp(escaped) }).click();
await op.waitForTimeout(1500);

await inv.reload({ waitUntil: 'networkidle' });
await dismissTour(inv);
await inv.waitForTimeout(1500);
marketplace = await inv.locator('body').innerText();
check(!marketplace.includes(NAME), 'pausing takes it out of the investor marketplace');

// ---- amending edits the row rather than adding another ----
await op.getByRole('button', { name: new RegExp(`Edit ${escaped}`) }).click();
await op.waitForSelector('dialog[open]');
await op.locator('dialog[open]').getByPlaceholder('5000').fill('9999');
await op
  .locator('dialog[open]')
  .getByRole('button', { name: /save changes/i })
  .click();
await op.waitForSelector('dialog[open]', { state: 'detached', timeout: 10_000 }).catch(() => {});
listed = await catalogue.innerText();
check(listed.includes('J$9,999'), 'an amendment saves and shows the new minimum');
check(listed.split(NAME).length === 2, 'amending updates the row rather than adding a second one');

// ---- the client drill-down ----
await op.getByRole('tab', { name: /clients/i }).click();
await op.waitForTimeout(1200);
const open = op.getByRole('button', { name: /^Open / }).first();
if (await open.count()) {
  await open.click();
  await op.waitForSelector('dialog[open]');
  await op.waitForTimeout(1200);
  const detail = await op.locator('dialog[open]').innerText();
  check(detail.includes('Where their money is with you'), 'the client drill-down opens');
  await op.keyboard.press('Escape');
} else {
  console.log('SKIP  no client rows in this database to open');
}

// ---- accepting commits to a date, settling records the execution ----
// Both were columns nobody wrote: `settlement_eta` since the first migration,
// and the price/units/fee not at all — an investor was told "settled" and
// never at what price.
await op.getByRole('tab', { name: /order flow/i }).click();
await op.waitForTimeout(1200);
const acceptBtn = op.getByRole('button', { name: /^Accept / }).first();
if (await acceptBtn.count()) {
  await acceptBtn.click();
  const iso = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await op.locator('input[type="date"]').first().fill(iso);
  await op
    .getByRole('button', { name: /^Accept$/ })
    .first()
    .click();
  await op.waitForTimeout(1500);

  const settleBtn = op.getByRole('button', { name: /^Settle / }).first();
  check((await settleBtn.count()) > 0, 'an accepted order offers Settle');
  await settleBtn.click();
  await op.getByPlaceholder('100.25').first().fill('100.25');
  await op.getByPlaceholder('50').first().fill('49.875');
  await op.getByPlaceholder('TRD-88214').first().fill('TRD-88214');
  await op.getByRole('button', { name: /confirm settled/i }).click();
  await op.waitForTimeout(1500);

  const queue = await op.locator('[data-tour="institution-orders"], main').innerText();
  check(queue.includes('49.875 units'), 'the settled row shows the units the firm reported');
  check(queue.includes('US$100.25'), 'the unit price shows to the cent, not rounded to US$100');
  check(queue.includes('TRD-88214'), 'the firm’s own reference is kept on the row');
} else {
  console.log('SKIP  no order awaiting acceptance in this database');
}

// ---- a firm corrects its own record ----
await op.getByRole('tab', { name: /compliance/i }).click();
await op.waitForTimeout(1000);
await op.getByRole('button', { name: /edit firm details/i }).click();
const NEW_KIND = `Funds · Insurance ${Date.now() % 10000}`;
await op
  .locator('input')
  .filter({ hasNot: op.locator('[type="date"]') })
  .nth(1)
  .fill(NEW_KIND);
await op.getByRole('button', { name: /^Save$/ }).click();
await op.waitForTimeout(2000);
const compliance = await op.locator('main').innerText();
check(compliance.includes(NEW_KIND), 'the firm’s edited details save and show');
check(
  compliance.includes('set by CCN') || compliance.includes('Partner code'),
  'the console still shows the fields CCN owns',
);

// ---- the audit trail reads as English ----
await op.getByRole('tab', { name: /compliance/i }).click();
await op.waitForTimeout(1200);
const audit = await op.locator('[data-tour="institution-audit"]').innerText();
check(audit.includes('Product listed'), 'the audit trail says "Product listed"');
check(
  !/instrument\.listed|product_listing|connected_accounts|reconciliation_items/.test(audit),
  'the audit trail prints no raw database identifiers',
);

await browser.close();
console.log(failures.length === 0 ? '\nALL CHECKS PASSED' : `\n${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
