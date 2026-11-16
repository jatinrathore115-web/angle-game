import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { cellRect, frameAt } from '../game/SpriteSheet';
import { METEOR_SHEET } from '../game/calibration';

const sheet = PNG.sync.read(fs.readFileSync(path.resolve(__dirname, '../../public/assets/meteor-30frame.png')));

describe('meteor sprite sheet (6 x 5, non-integer cells)', () => {
  it('has the expected size and is not evenly divisible', () => {
    expect([sheet.width, sheet.height]).toEqual([1774, 887]);
    expect(sheet.width % 6 !== 0 || sheet.height % 5 !== 0).toBe(true);
  });

  it('30 cells tile the sheet exactly: in bounds, no gaps, no overlap', () => {
    let area = 0;
    for (let i = 0; i < 30; i++) {
      const r = cellRect(i, sheet.width, sheet.height, 6, 5);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(sheet.width);
      expect(r.y + r.h).toBeLessThanOrEqual(sheet.height);
      if (i % 6 < 5) expect(cellRect(i + 1, sheet.width, sheet.height, 6, 5).x).toBe(r.x + r.w);
      if (i < 24) expect(cellRect(i + 6, sheet.width, sheet.height, 6, 5).y).toBe(r.y + r.h);
      area += r.w * r.h;
    }
    expect(area).toBe(sheet.width * sheet.height);
  });

  it('every frame has visible alpha content and transparent corners (no black boxes)', () => {
    for (let i = 0; i < 30; i++) {
      const r = cellRect(i, sheet.width, sheet.height, 6, 5);
      let opaque = 0;
      for (let y = r.y; y < r.y + r.h; y += 2) for (let x = r.x; x < r.x + r.w; x += 2) {
        if (sheet.data[(y * sheet.width + x) * 4 + 3] > 128) opaque++;
      }
      expect(opaque).toBeGreaterThan(200);
      const a = (x: number, y: number) => sheet.data[(y * sheet.width + x) * 4 + 3];
      expect(a(r.x + 2, r.y + 2)).toBeLessThan(10);
    }
  });

  it('calibrated head anchors match the slicing and lie on the opaque rock', () => {
    expect(METEOR_SHEET.frames).toHaveLength(30);
    METEOR_SHEET.frames.forEach((f, i) => {
      expect(f.rect).toEqual(cellRect(i, sheet.width, sheet.height, 6, 5));
      expect(f.head.x).toBeGreaterThan(f.rect.w * 0.5);
      expect(f.head.x).toBeLessThan(f.rect.w);
      const x = Math.round(f.rect.x + f.head.x), y = Math.round(f.rect.y + f.head.y);
      expect(sheet.data[(y * sheet.width + x) * 4 + 3]).toBeGreaterThan(200);
    });
  });

  it('playback ignites 0..11 then ping-pongs 12..29 without jumps', () => {
    let prev = frameAt(0, 15, 11, 12, 29);
    for (let t = 1; t < 600; t++) {
      const f = frameAt((t + 0.5) / 15, 15, 11, 12, 29);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(29);
      expect(Math.abs(f - prev)).toBeLessThanOrEqual(1);
      prev = f;
    }
  });
});
