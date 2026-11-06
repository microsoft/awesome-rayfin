// Browser proof for Caldova Finance, headless Edge against the offline build or dev server.
//
//   node tools/probe.mjs [baseUrl] [--shots]
//
// Every page at 1366x768-class and 1920x1080 viewports: the document and every panel fit (no scroll, no
// overflow), no NaN/undefined/Infinity, no page error. Then the action flow offline: adjust the forecast,
// see cash at year end move, comment, sign off, and see a late adjustment refused. Exit 1 on any failure.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5241/';
const shots = process.argv.includes('--shots');
mkdirSync('logs/probe', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
let failed = false;
const fail = (why) => {
  failed = true;
  console.log('FAIL', why);
};

for (const [w, h] of [
  [1366, 657],
  [1920, 969],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('table tbody tr');
  for (const [label, id] of [
    ['Income statement', 'pl'],
    ['Balance sheet', 'bs'],
    ['Cash flow', 'cf'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const d = document.documentElement;
      const over = [...document.querySelectorAll('.panel')].filter((p) => p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1).length;
      const cut = [...document.querySelectorAll('td')].filter((td) => td.scrollWidth > td.clientWidth + 1 && !td.classList.contains('truncate')).length;
      const text = document.body.innerText;
      return { scroll: d.scrollHeight > d.clientHeight || d.scrollWidth > d.clientWidth, over, cut, bad: /NaN|undefined|Infinity/.test(text) };
    });
    if (r.scroll) fail(`${w}x${h} ${label}: the document scrolls`);
    if (r.over) fail(`${w}x${h} ${label}: ${r.over} panel(s) overflow`);
    if (r.cut) fail(`${w}x${h} ${label}: ${r.cut} number cell(s) cut`);
    if (r.bad) fail(`${w}x${h} ${label}: NaN/undefined/Infinity on the page`);
    if (shots) await page.screenshot({ path: `logs/probe/${id}-${w}.png` });

    // The same statement as Michael Tenner's original visual: drawn from the baked answers, fits.
    await page.getByRole('radio', { name: 'Original visual' }).click();
    try {
      await page.waitForFunction(() => (document.querySelector('.pnl-root')?.textContent ?? '').length > 200, null, { timeout: 8000 });
    } catch {
      fail(`${w}x${h} ${label}: the original visual did not draw`);
    }
    await page.waitForTimeout(500);
    const v = await page.evaluate(() => {
      const d = document.documentElement;
      const tile = document.querySelector('[data-dwg-tile]')?.closest('section')?.getBoundingClientRect();
      const footer = document.querySelector('footer')?.getBoundingClientRect();
      return {
        scroll: d.scrollHeight > d.clientHeight || d.scrollWidth > d.clientWidth,
        missing: !!document.querySelector('[data-dwg-tile] [role="alert"]'),
        under: tile && footer ? tile.bottom > footer.top + 1 : false,
      };
    });
    if (v.scroll) fail(`${w}x${h} ${label} original visual: the document scrolls`);
    if (v.missing) fail(`${w}x${h} ${label} original visual: a query has no baked answer`);
    if (v.under) fail(`${w}x${h} ${label} original visual: runs under the footer`);
    if (shots) await page.screenshot({ path: `logs/probe/${id}-visual-${w}.png` });
    await page.getByRole('radio', { name: 'Table' }).click();
  }
  if (errors.length) fail(`${w}x${h}: page errors: ${errors.join(' | ')}`);
  await page.close();
}

// The action flow (offline store), at the smaller size.
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 657 } });
  page.setDefaultTimeout(8000);
  try {
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('table tbody tr');
  const cashDec = async () => {
    await page.getByRole('button', { name: 'Balance sheet', exact: true }).click();
    await page.getByRole('combobox').first().selectOption('2026-12');
    const v = await page.locator('tr', { hasText: 'Cash' }).first().locator('td').nth(3).innerText();
    await page.getByRole('combobox').first().selectOption('2026-09');
    await page.getByRole('button', { name: 'Income statement', exact: true }).click();
    return Number(v.replace(/[,\s]/g, '').replace('−', '-'));
  };
  const before = await cashDec();
  await page.getByRole('button', { name: /Expand Operating expenses/ }).click();
  await page.getByRole('button', { name: /Expand Premises/ }).click();
  await page.locator('tr', { hasText: 'Distribution centre rent' }).click();
  await page.getByLabel('Amount in kEUR').fill('100');
  await page.getByLabel('Reason').fill('Rent indexation from October');
  await page.getByRole('button', { name: 'Save adjustment' }).click();
  await page.waitForTimeout(300);
  const after = await cashDec();
  if (!(after < before - 60)) fail(`adjustment did not move year-end cash: ${before} -> ${after}`);
  // Switching pages collapsed the P&L again: comment on the block line, which carries the marker now.
  await page.locator('tr', { hasText: 'Operating expenses' }).first().click();
  await page.getByPlaceholder('Explain this line…').fill('Rent up 3.4% (index clause)');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForTimeout(200);
  if (!(await page.getByText('Rent up 3.4% (index clause)').isVisible())) fail('comment not shown');
  if (shots) await page.screenshot({ path: 'logs/probe/drawer-1366.png' });
  await page.getByRole('button', { name: 'Sign off close' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.waitForTimeout(200);
  if (!(await page.getByText(/close: signed off/).isVisible())) fail('sign-off not shown');
  if (!(await page.getByText('The close is signed off. A controller can reopen it.').isVisible())) fail('adjusting still possible after sign-off');
  // The sign-off froze the rent adjustment: it must still apply.
  const frozen = await cashDec();
  if (frozen !== after) fail(`signed-off close changed year-end cash: ${after} -> ${frozen}`);
  if (shots) await page.screenshot({ path: 'logs/probe/signed-1366.png' });
  console.log(`flow: year-end cash ${before} -> ${after} kEUR after +100 kEUR rent; comment and sign-off shown`);
  } catch (e) {
    fail(`flow: ${String(e).split(String.fromCharCode(10))[0]}`);
    await page.screenshot({ path: 'logs/probe/flow-failed.png' });
  }
  await page.close();
}

await browser.close();
console.log(failed ? 'PROBE FAILED' : 'probe ok');
process.exit(failed ? 1 : 0);
