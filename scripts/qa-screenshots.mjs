// Browser QA: drives the real game in Chrome/Edge and captures screenshots.
// Usage: node scripts/qa-screenshots.mjs <outDir> [url] [scenario]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] ?? 'qa-shots';
const url = process.argv[3] ?? 'http://localhost:5173/';
const scenario = process.argv[4] ?? 'all';
fs.mkdirSync(outDir, { recursive: true });

const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];

async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${w}x${h}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${w}x${h}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`[${w}x${h}] requestfailed: ${r.url()}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game);
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const dbg = (page) => page.evaluate(() => window.__game.debug());
const waitState = (page, s, timeout = 8000) => page.waitForFunction((st) => window.__game.debug().state === st, s, { timeout });
const clickValue = (page, v) => page.evaluate((val) => {
  const b = [...document.querySelectorAll('#options .opt')].find((x) => x.dataset.value === String(val));
  b.click();
}, v);

if (scenario === 'all' || scenario === 'layout') {
  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    const page = await open(w, h);
    await page.waitForTimeout(400);
    await shot(page, `title-${w}`);
    await page.click('#btn-play');
    await waitState(page, 'QUESTION_ACTIVE');
    await page.waitForTimeout(1200);
    await shot(page, `round1-${w}`);
    console.log(w, JSON.stringify(await dbg(page)));
    await page.close();
  }
}

if (scenario === 'all' || scenario === 'flow') {
  const page = await open(1920, 1080);
  await page.click('#btn-play');
  await waitState(page, 'QUESTION_ACTIVE');
  await page.waitForTimeout(900);
  // wrong answer
  await clickValue(page, 114);
  await waitState(page, 'FIRING');
  await page.waitForTimeout(140);
  await shot(page, 'wrong-flight');
  await page.waitForFunction(() => window.__game.round.wrongThisRound >= 1, null, { timeout: 8000 });
  await page.waitForTimeout(60);
  await shot(page, 'wrong-miss');
  console.log('after wrong', JSON.stringify(await dbg(page)));
  await waitState(page, 'QUESTION_ACTIVE');
  await page.waitForTimeout(700);
  // correct answer
  await clickValue(page, 104);
  await waitState(page, 'FIRING');
  await page.waitForTimeout(150);
  await shot(page, 'correct-flight');
  await page.waitForFunction(() => window.__game.debug().explosions >= 1, null, { timeout: 8000 });
  await page.waitForTimeout(90);
  await shot(page, 'explosion-early');
  await page.waitForTimeout(300);
  await shot(page, 'explosion-mid');
  await page.waitForTimeout(500);
  await shot(page, 'explosion-smoke');
  console.log('after hit', JSON.stringify(await dbg(page)));
  // play the remaining curated levels correctly and screenshot each question
  for (let i = 2; i <= 12; i++) {
    await waitState(page, 'QUESTION_ACTIVE', 12000);
    await page.waitForTimeout(900);
    const d = await dbg(page);
    await shot(page, `level-${String(i).padStart(2, '0')}`);
    console.log('level', d.level, 'lives', d.lives, 'progress', d.meteor?.progress?.toFixed(2), 'answer', d.answer, 'target', d.targetBearing.toFixed(1), 'ref', d.referenceRay.toFixed(1), 'bearingToMeteor', d.bearingToMeteor.toFixed(2));
    await clickValue(page, d.answer);
    const before = d.explosions;
    await page.waitForFunction((n) => window.__game.debug().explosions > n || window.__game.round.wrongThisRound > 0, before, { timeout: 8000 });
    const after = await dbg(page);
    if (after.explosions <= before) console.log('!!! correct answer missed at', d.level);
    if (i === 6) { await page.waitForTimeout(250); await shot(page, 'explosion-other-side'); }
  }
  await waitState(page, 'WON', 8000);
  await page.waitForTimeout(800);
  await shot(page, 'victory');
  console.log('won', JSON.stringify(await dbg(page)));
  await page.close();
}

if (scenario === 'all' || scenario === 'slowmo') {
  const page = await open(1920, 1080);
  await page.click('#btn-play');
  await waitState(page, 'QUESTION_ACTIVE');
  await page.waitForTimeout(600);
  await page.evaluate(() => (window.__game.timeScale = 0.08));
  await clickValue(page, 104);
  await waitState(page, 'FIRING', 20000);
  await page.waitForTimeout(60);
  await shot(page, 'slow-muzzle');
  await page.waitForTimeout(1500);
  await shot(page, 'slow-projectile');
  await page.waitForFunction(() => window.__game.debug().explosions >= 1, null, { timeout: 20000 });
  for (const [ms, name] of [[0, 'slow-x0-contact'], [1300, 'slow-x1-fireball'], [1500, 'slow-x2-debris'], [5000, 'slow-x3-smoke'], [6000, 'slow-x4-late']]) {
    if (ms) await page.waitForTimeout(ms);
    await shot(page, name);
  }
  await page.close();
}

if (scenario === 'all' || scenario === 'lose') {
  const page = await open(1920, 1080);
  await page.click('#btn-play');
  await waitState(page, 'QUESTION_ACTIVE');
  // let meteors hit the core three times (speed up via time scale is not available; wait)
  for (let i = 0; i < 3; i++) {
    await waitState(page, 'IMPACT_RECOVERY', 20000);
    await page.waitForTimeout(120);
    await shot(page, `shield-hit-${i + 1}`);
  }
  await waitState(page, 'GAME_OVER', 6000);
  await page.waitForTimeout(600);
  await shot(page, 'game-over');
  await page.close();
}

if (scenario === 'all' || scenario === 'mobile') {
  const page = await open(844, 390);
  await page.click('#btn-play');
  await waitState(page, 'QUESTION_ACTIVE');
  await page.waitForTimeout(800);
  await shot(page, 'mobile-landscape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot(page, 'mobile-portrait');
  await page.close();
}

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
