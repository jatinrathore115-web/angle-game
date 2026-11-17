// Mobile Safari (WebKit) QA with Playwright's real iPhone/iPad profiles.
// Usage: node scripts/qa-webkit.mjs <outDir> [url]
import { webkit, devices } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] ?? 'qa-webkit';
const url = process.argv[3] ?? 'http://localhost:5173/';
fs.mkdirSync(outDir, { recursive: true });

const PROFILES = ['iPhone SE', 'iPhone 14', 'iPhone 14 landscape', 'iPad (gen 7)', 'iPad (gen 7) landscape'];
const browser = await webkit.launch();
let failures = 0;

for (const name of PROFILES) {
  const ctx = await browser.newContext({ ...devices[name] });
  const p = await ctx.newPage();
  const log = [];
  p.on('pageerror', (e) => log.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
  p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && log.push(`console.${m.type()}: ${m.text()}`));
  p.on('requestfailed', (r) => log.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  const steps = [];
  const shot = (s) => p.screenshot({ path: path.join(outDir, `${name.replace(/[^a-z0-9]+/gi, '-')}-${s}.png`) });
  try {
    await p.goto(url, { waitUntil: 'load', timeout: 30000 });
    const booted = await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 }).then(() => true, () => false);
    steps.push(`booted:${booted}`);
    if (!booted) {
      await shot('boot-fail');
      steps.push('load-text: ' + (await p.textContent('#load-text').catch(() => '?')));
      throw new Error('game did not boot');
    }
    await p.waitForFunction(() => !document.getElementById('btn-play').disabled, null, { timeout: 15000 });
    await p.waitForTimeout(400);
    await shot('start');
    await p.tap('#btn-play');
    const started = await p.waitForFunction(() => window.__game.debug().state === 'QUESTION_ACTIVE', null, { timeout: 10000 }).then(() => true, () => false);
    steps.push(`started:${started} state=${await p.evaluate(() => window.__game.debug().state)}`);
    await p.waitForTimeout(700);
    await shot('play');
    if (started) {
      const d = await p.evaluate(() => window.__game.debug());
      await p.tap(`#options .opt[data-value="${d.answer}"]`);
      const hit = await p.waitForFunction((n) => window.__game.debug().explosions > n, d.explosions, { timeout: 8000 }).then(() => true, () => false);
      steps.push(`hit:${hit} state=${await p.evaluate(() => window.__game.debug().state)}`);
      await p.waitForTimeout(250);
      await shot('after-tap');
    }
  } catch (e) {
    steps.push('ERROR ' + e.message.split('\n')[0]);
  }
  const ok = steps.every((s) => !/false|ERROR/.test(s)) && !log.some((l) => l.startsWith('pageerror'));
  if (!ok) failures++;
  console.log(`\n${ok ? 'PASS' : 'FAIL'} ${name}  ${JSON.stringify(devices[name].viewport)}\n  ${steps.join('\n  ')}`);
  if (log.length) console.log('  ' + log.join('\n  '));
  await ctx.close();
}
await browser.close();
console.log(`\n${failures ? failures + ' profile(s) FAILED' : 'all profiles passed'}`);
