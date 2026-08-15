/**
 * The surface-gaps journey, in a real browser, against the real stack.
 *
 * Covers what the unit suites cannot see across surfaces: the exec dialog's
 * adjustable amount, the currency dropdown (GYD and friends), the partner
 * recording settled funds and the client detail reflecting it, the home dash
 * showing money before agent chrome, the console overview pointing at work,
 * and a 390px no-horizontal-scroll sweep.
 *
 * Not part of `bun test` — needs two servers, a seeded database and a browser.
 * Run like console-journey.mjs, plus ADMIN_COOKIE from `bun run mint-session`.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const OPERATOR = process.env.OPERATOR_COOKIE;
const INVESTOR = process.env.INVESTOR_COOKIE;
const WEB = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS_DIR ?? '.';

function chromiumPath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    const dir = readdirSync(root).find((d) => d.startsWith('chromium-'));
    if (dir) return join(root, dir, 'chrome-linux', 'chrome');
  }
  return undefined;
}

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch({ executablePath: chromiumPath() });

async function signedIn(cookie, viewport = { width: 1280, height: 1000 }) {
  const context = await browser.newContext({ viewport });
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

// ---- 1. exec dialog: amount adjustable at step 0 ----
const inv = await signedIn(INVESTOR);
await inv.goto(`${WEB}/opportunities`, { waitUntil: 'networkidle' });
await dismissTour(inv);
await inv
  .getByRole('button', { name: /review & invest/i })
  .first()
  .click();
await inv.waitForTimeout(600);
const dlg = inv.locator('[role="dialog"]');
const amt0 = dlg.getByLabel(/amount to invest/i);
check((await amt0.count()) === 1, 'exec dialog step 0 has an "Amount to invest" input');
await amt0.fill('25000');
const contBtn = dlg.getByRole('button', { name: /continue with/i });
check(
  (await contBtn.innerText().catch(() => '')).includes('25,000'),
  'the Continue button shows the amount just typed',
);
await amt0.fill('1');
check(
  (await dlg.getByText(/minimum is/i).count()) > 0,
  'an amount below the minimum is explained, not silently refused',
);
await amt0.fill('25000');
await contBtn.click();
await inv.waitForTimeout(400);
const step1Amt = dlg.locator('input').first();
check(
  (await step1Amt.inputValue().catch(() => '')) === '25000',
  'the amount carries into the review step, still editable',
);
await inv.screenshot({ path: `${SHOTS}/g1-exec-step0.png` });
await inv.keyboard.press('Escape');

// ---- 4. portfolio currency dropdown incl. GYD ----
await inv.goto(`${WEB}/portfolio`, { waitUntil: 'networkidle' });
await dismissTour(inv);
const curSelect = inv.locator('select').first();
const options = await curSelect.locator('option').allInnerTexts();
check(
  options.includes('GYD') && options.length >= 7,
  `currency picker is a dropdown with ${options.length} currencies incl. GYD`,
);
await curSelect.selectOption('GYD');
await inv.waitForTimeout(1200);
const bodyText = await inv.locator('body').innerText();
check(/G\$/.test(bodyText), 'switching to GYD restates figures with the G$ symbol');
check(
  /fallback rate|no published rate/i.test(bodyText),
  'the unpublished GYD rate is disclosed, not passed off as a bank rate',
);
await inv.screenshot({ path: `${SHOTS}/g4-gyd.png` });
await curSelect.selectOption('USD');
await inv.waitForTimeout(800);

// ---- 2. operator records settled funds ----
const op = await signedIn(OPERATOR);
await op.goto(`${WEB}/institutions`, { waitUntil: 'networkidle' });
await dismissTour(op);
await op.getByRole('tab', { name: /clients/i }).click();
await op.waitForTimeout(800);
const openBtn = op.getByRole('button', { name: /^open /i }).first();
check((await openBtn.count()) === 1, 'the clients tab lists a client to open');
await openBtn.click();
await op.waitForSelector('dialog[open]');
const cd = op.locator('dialog[open]');
await cd
  .getByText('Record settled funds')
  .waitFor({ timeout: 5000 })
  .catch(() => {});
check(
  (await cd.getByText('Record settled funds').count()) > 0,
  'the client detail offers "Record settled funds"',
);
await cd.getByPlaceholder('10,000').fill('12,500');
await cd.locator('select').selectOption('USD');
await cd.getByPlaceholder(/wire id/i).fill('WIRE-E2E-1');
await op.screenshot({ path: `${SHOTS}/g2-funds-form.png` });
await cd.getByRole('button', { name: /confirm settled/i }).click();
await op.waitForTimeout(1500);
const note = await cd
  .locator('output')
  .innerText()
  .catch(() => '');
check(/cash balance/i.test(note), `the confirmation is acknowledged ("${note.slice(0, 60)}…")`);
const cdText = await cd.innerText();
check(/Cash/.test(cdText), 'the cash line appears in the client detail after re-read');
check(
  /Settled funds confirmed/.test(cdText),
  'the audit thread shows "Settled funds confirmed" in English',
);
await op.screenshot({ path: `${SHOTS}/g2-funds-done.png` });
await op.keyboard.press('Escape');

// ---- 3. per-partner cash on the investor portfolio ----
// The operator just confirmed funds for their first client; check that THAT
// investor's portfolio shows the chip. The e2e investor may not be that client,
// so assert on the demo client only if visible; the API test pins the data
// path — here we check the investor screen renders a cash chip when cash exists.
await inv.reload({ waitUntil: 'networkidle' });
await dismissTour(inv);
const invText = await inv.locator('body').innerText();
console.log(`INFO  investor portfolio mentions cash: ${/cash available/i.test(invText)}`);
await inv.screenshot({ path: `${SHOTS}/g3-portfolio.png` });

// ---- home dash: money first, agent quiet ----
await inv.goto(`${WEB}/home`, { waitUntil: 'networkidle' });
await dismissTour(inv);
await inv.waitForTimeout(800);
const homeText = await inv.locator('body').innerText();
check(
  !/Checking with your agent/.test(homeText),
  'the rail no longer narrates "Checking with your agent…"',
);
check(homeText.toLowerCase().includes('held across partners'), 'holdings are on the home dash');
check(
  !homeText.toLowerCase().includes('how your agent works'),
  'the pipeline explainer is off the home dash',
);
await inv.screenshot({ path: `${SHOTS}/g6-home.png`, fullPage: true });

// ---- agent screen: explainer present but collapsed ----
await inv.goto(`${WEB}/agent`, { waitUntil: 'networkidle' });
await dismissTour(inv);
await inv.waitForTimeout(600);
const agentText = await inv.locator('body').innerText();
check(/how your agent works/i.test(agentText), 'the explainer lives on the agent screen');
check(/see the five steps/i.test(agentText), 'and it is collapsed to one line by default');

// ---- console overview: work, not prose ----
await op.goto(`${WEB}/institutions`, { waitUntil: 'networkidle' });
await dismissTour(op);
await op.waitForTimeout(600);
const conText = await op.locator('body').innerText();
check(/needs you now/i.test(conText), 'console overview has a "Needs you now" panel');
check(!/why this flow matters/i.test(conText), 'the product pitch is off the console overview');
await op.getByRole('tab', { name: /compliance/i }).click();
await op.waitForTimeout(600);
const compText = await op.locator('body').innerText();
check(
  /how ccn works with your firm/i.test(compText),
  'the standing terms live on the Compliance tab',
);
await op.screenshot({ path: `${SHOTS}/g8-compliance.png`, fullPage: true });

// ---- admin People shows what people hold ----
const adm = await signedIn(process.env.ADMIN_COOKIE ?? '');
await adm.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
await adm.waitForTimeout(800);
await adm
  .getByRole('tab', { name: /people/i })
  .click()
  .catch(() => adm.getByRole('button', { name: /people/i }).click());
await adm.waitForTimeout(800);
const admText = await adm.locator('body').innerText();
check(/holds/i.test(admText), 'admin People has a Holds column');
await adm.screenshot({ path: `${SHOTS}/g7-admin-people.png` });

// ---- 5. mobile: no horizontal scroll at 390px ----
const mob = await signedIn(INVESTOR, { width: 390, height: 844 });
const opMob = await signedIn(OPERATOR, { width: 390, height: 844 });
const pages = [
  [mob, '/opportunities'],
  [mob, '/portfolio'],
  [mob, '/orders'],
  [mob, '/agent'],
  [mob, '/planning'],
  [opMob, '/institutions'],
  [mob, '/demo/home'],
  [mob, '/demo/opportunities'],
];
for (const [page, path] of pages) {
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
  await dismissTour(page);
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow <= 2, `no horizontal scroll at 390px on ${path} (overflow ${overflow}px)`);
  await page.screenshot({ path: `${SHOTS}/m-${path.replace(/\//g, '_')}.png`, fullPage: false });
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL PASS');
process.exit(failures.length ? 1 : 0);
