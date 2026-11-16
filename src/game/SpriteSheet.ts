/**
 * Exact fractional grid slicing. The meteor sheet (1774x887) is not divisible by
 * 6x5, so every boundary is rounded independently: neighbouring cells share an
 * edge exactly, with no cumulative drift, gaps or overlaps.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function cellRect(index: number, sheetW: number, sheetH: number, cols: number, rows: number): Rect {
  const c = index % cols;
  const r = Math.floor(index / cols);
  const x0 = Math.round((c * sheetW) / cols);
  const x1 = Math.round(((c + 1) * sheetW) / cols);
  const y0 = Math.round((r * sheetH) / rows);
  const y1 = Math.round(((r + 1) * sheetH) / rows);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Playback order: 0..introEnd once (ignition), then ping-pong loopStart..last so
 * the tail length never teleports from long back to short.
 */
export function frameAt(time: number, fps: number, introEnd: number, loopStart: number, last: number): number {
  const f = Math.floor(time * fps);
  if (f <= introEnd) return f;
  const span = last - loopStart;
  const k = (f - introEnd - 1) % (span * 2);
  return k <= span ? loopStart + k : last - (k - span);
}
