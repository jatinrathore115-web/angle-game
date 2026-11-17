// Responsive QA across a device matrix (touch emulation for phones/tablets).
// Usage: node scripts/qa-devices.mjs <outDir> [url]
// Checks per device: start via tap/click, answer buttons >= 44 CSS px, no overlaps between
// controls, everything inside the viewport, no page scroll, and a correct tap really hits.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const outDir = process.argv[2] ?? 'qa-devices';
const url = process.argv[3] ?? 'http://localhost:5173/';
fs.mkdirSync(outDir, { recursive: true });

const DEVICES = [
  { name: 'iPhone SE landscape', w: 667, h: 375, dpr: 2, touch: true },
  { name: 'iPhone 14 landscape', w: 844, h: 390, dpr: 3, touch: true },
  { name: 'iPhone 14 portrait', w: 390, h: 844, dpr: 3, touch: true },
  { name: 'Android small portrait', w: 360, h: 740, dpr: 3, touch: true },
  { name: 'Pixel 7 landscape', w: 915, h: 412, dpr: 2.625, touch: true },
  { name: 'iPad landscape', w: 1024, h: 768, dpr: 2, touch: true },
  { name: 'iPad portrait', w: 768, h: 1024, dpr: 2, touch: true },
  { name: 'iPad Pro landscape', w: 1366, h: 1024, dpr: 2, touch: true },
  { name: 'Laptop 1366x768', w: 1366, h: 768, dpr: 1, touch: false },
  { name: 'Laptop 1280x800', w: 1280, h: 800, dpr: 1, touch: false },
  { name: 'MacBook 1440x900', w: 1440, h: 900, dpr: 2, touch: false },
  { name: 'Desktop 1920x1080', w: 1920, h: 1080, dpr: 1, touch: false },
  { name: 'Desktop 2560x1440', w: 2560, h: 1440, dpr: 1, touch: false },
  { name: 'Ultrawide 3440x1440', w: 3440, h: 1440, dpr: 1, touch: false },
  { name: 'Desktop portrait window', w: 900, h: 1200, dpr: 1, touch: false },
  { name: 'Tiny window 640x360', w: 640, h: 360, dpr: 1, touch: false },
];

const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const results = [];
const thumbs = [];

for (const d of DEVICES) {
  const ctx = await browser.newContext({
    viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: d.touch, hasTouch: d.touch,
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const issues = [];
  try {
    await p.goto(url, { waitUntil: 'load' });
    await p.waitForFunction(() => !!window.__game && !document.getElementById('btn-play').disabled, null, { timeout: 15000 });
    await p.waitForTimeout(500);
    const startBox = await p.locator('#btn-play').boundingBox();
    if (!startBox || startBox.width < 44) issues.push(`start button only ${startBox?.width.toFixed(0)}px`);
    if (d.touch) await p.tap('#btn-play'); else await p.click('#btn-play');
    await p.waitForFunction(() => window.__game.debug().state === 'QUESTION_ACTIVE', null, { timeout: 10000 });
    await p.waitForTimeout(900);
    const file = path.join(outDir, `${d.name.replace(/[^a-z0-9]+/gi, '-')}.png`);
    await p.screenshot({ path: file });
    thumbs.push({ name: d.name, file });

    const m = await p.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, id: el.id || el.className }; };
      const opts = [...document.querySelectorAll('#options .opt')].map(r);
      const ctrls = [...opts, r(document.getElementById('btn-hint')), ...[...document.querySelectorAll('.hud-chip')].map(r)];
      const game = window.__game;
      return {
        opts, ctrls,
        vw: innerWidth, vh: innerHeight,
        scroll: [document.documentElement.scrollWidth > innerWidth, document.documentElement.scrollHeight > innerHeight],
        ui: game.rs.ui, rotated: game.rs.rotated, scale: game.rs.scale, labelScale: game.overlay.labelScale,
        answer: game.debug().answer,
      };
    });
    const minOpt = Math.min(...m.opts.map((o) => Math.min(o.w, o.h)));
    if (minOpt < 44) issues.push(`answer button only ${minOpt.toFixed(1)}px`);
    for (let i = 0; i < m.ctrls.length; i++) for (let j = i + 1; j < m.ctrls.length; j++) {
      const a = m.ctrls[i], b = m.ctrls[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) issues.push(`overlap ${a.id} / ${b.id}`);
    }
    for (const c of m.ctrls) if (c.x < -1 || c.y < -1 || c.x + c.w > m.vw + 1 || c.y + c.h > m.vh + 1) issues.push(`off-screen ${c.id}`);
    if (m.scroll[0] || m.scroll[1]) issues.push('page scrolls');

    // play: tap the correct answer, the shot must hit
    const before = (await p.evaluate(() => window.__game.debug())).explosions;
    const sel = `#options .opt[data-value="${m.answer}"]`;
    if (d.touch) await p.tap(sel); else await p.click(sel);
    const hit = await p.waitForFunction((n) => window.__game.debug().explosions > n, before, { timeout: 8000 }).then(() => true, () => false);
    if (!hit) issues.push('correct answer did not register / hit');

    results.push({
      device: `${d.name} (${d.w}x${d.h})`, scale: m.scale.toFixed(2), ui: m.ui.toFixed(2), rotated: m.rotated,
      minAnswerBtnPx: +minOpt.toFixed(1), hit, issues: [...issues, ...errs.map((e) => 'console: ' + e)],
    });
  } catch (e) {
    results.push({ device: `${d.name} (${d.w}x${d.h})`, issues: ['FAILED: ' + e.message.split('\n')[0]] });
  }
  await ctx.close();
}
await browser.close();

for (const r of results) {
  const ok = r.issues.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.device.padEnd(36)} scale ${r.scale}  ui ${r.ui}  rot ${r.rotated ? 'Y' : '-'}  btn ${r.minAnswerBtnPx}px  ${ok ? '' : r.issues.join('; ')}`);
}

// contact sheet (each screenshot box-downscaled to fit a 480x300 cell)
const CW = 480, CH = 300, COLS = 4;
const rows = Math.ceil(thumbs.length / COLS);
const sheet = new PNG({ width: CW * COLS, height: CH * rows });
sheet.data.fill(30);
thumbs.forEach((t, i) => {
  const im = PNG.sync.read(fs.readFileSync(t.file));
  const k = Math.max(im.width / CW, im.height / CH);
  const w = Math.floor(im.width / k), h = Math.floor(im.height / k);
  const ox = (i % COLS) * CW + Math.floor((CW - w) / 2), oy = Math.floor(i / COLS) * CH + Math.floor((CH - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (Math.floor(y * k) * im.width + Math.floor(x * k)) * 4, o = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[o] = im.data[s]; sheet.data[o + 1] = im.data[s + 1]; sheet.data[o + 2] = im.data[s + 2]; sheet.data[o + 3] = 255;
  }
});
fs.writeFileSync(path.join(outDir, 'contact-sheet.png'), PNG.sync.write(sheet));
console.log('contact sheet:', path.join(outDir, 'contact-sheet.png'));
