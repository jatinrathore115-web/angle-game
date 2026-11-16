import { answerFor, preferredTurnSign } from './AngleMath';
import type { LevelDef, Relation } from './types';

interface CuratedSeed {
  knownDeg: number;
  relation: Relation;
  options: number[];
  bearing: number;
}

/**
 * Curated opening bank (Grade 9 lines & angles). Correct answers are NOT stored —
 * they are always computed by answerFor(). Bearings place each meteor on a
 * different side of the turret; L1 matches the reference layout (upper-left).
 */
const SEEDS: CuratedSeed[] = [
  { knownDeg: 76, relation: 'linear-pair', options: [76, 104, 114, 80], bearing: 204.4 },
  { knownDeg: 68, relation: 'vertical', options: [68, 112, 136, 180], bearing: 335 },
  { knownDeg: 118, relation: 'linear-pair', options: [62, 118, 180, 242], bearing: 155 },
  { knownDeg: 43, relation: 'linear-pair', options: [43, 137, 180, 223], bearing: 270 },
  { knownDeg: 113, relation: 'vertical', options: [67, 113, 180, 226], bearing: 22 },
  { knownDeg: 152, relation: 'linear-pair', options: [28, 152, 180, 332], bearing: 228 },
  { knownDeg: 47, relation: 'vertical', options: [47, 94, 133, 180], bearing: 0 },
  { knownDeg: 91, relation: 'linear-pair', options: [89, 91, 180, 271], bearing: 292 },
];

export const SPAWN_BEARINGS = [0, 22, 155, 180, 204, 228, 250, 270, 292, 315, 335];

function make(id: number, s: CuratedSeed, mastery = false): LevelDef {
  const answer = answerFor(s.relation, s.knownDeg);
  return {
    id,
    label: mastery ? `M${id - CURATED_COUNT}` : `L${id}`,
    knownDeg: s.knownDeg,
    relation: s.relation,
    options: [...s.options],
    targetBearingDeg: s.bearing,
    turnSign: preferredTurnSign(s.bearing, answer),
    speedTier: Math.min(id - 1, 9),
    mastery,
  };
}

export const CURATED_COUNT = SEEDS.length;
export const MASTERY_COUNT = 4;
export const TOTAL_LEVELS = CURATED_COUNT + MASTERY_COUNT;

export function curatedLevels(): LevelDef[] {
  return SEEDS.map((s, i) => make(i + 1, s));
}

export function validateLevel(l: LevelDef): string[] {
  const errs: string[] = [];
  const answer = answerFor(l.relation, l.knownDeg);
  const hits = l.options.filter((o) => o === answer).length;
  if (l.options.length !== 4) errs.push(`L${l.id}: needs exactly 4 options`);
  if (hits !== 1) errs.push(`L${l.id}: ${hits} options equal the answer ${answer}`);
  if (new Set(l.options).size !== l.options.length) errs.push(`L${l.id}: duplicate options`);
  if (l.knownDeg <= 0 || l.knownDeg >= 180) errs.push(`L${l.id}: known angle out of range`);
  return errs;
}

/** Small deterministic PRNG so runs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Generate a mathematically valid mastery problem with plausible distractors. */
export function generateMasteryLevel(id: number, rng: () => number, avoidBearing?: number): LevelDef {
  const relation: Relation = rng() < 0.5 ? 'linear-pair' : 'vertical';
  let known = 25 + Math.floor(rng() * 131); // 25..155
  if (Math.abs(known - 90) < 3) known += 7;
  const answer = answerFor(relation, known);
  const supplement = 180 - known;
  // Distractors model real misconceptions: copying the known, using the supplement, doubling, 360-x, x±10
  const pool = [known, supplement, 180, 360 - answer, answer + 10, answer - 10, known * 2]
    .filter((v) => v > 0 && v < 360 && Math.abs(v - answer) >= 4);
  const opts = new Set<number>([answer]);
  for (const v of shuffle(pool, rng)) {
    if (opts.size >= 4) break;
    if ([...opts].every((o) => Math.abs(o - v) >= 4)) opts.add(v);
  }
  let filler = answer + 20;
  while (opts.size < 4) {
    if ([...opts].every((o) => Math.abs(o - filler) >= 4) && filler < 360) opts.add(filler);
    filler += 17;
  }
  const choices = SPAWN_BEARINGS.filter((b) => avoidBearing === undefined || Math.abs(b - avoidBearing) > 30);
  const bearing = choices[Math.floor(rng() * choices.length)];
  const lvl = make(id, { knownDeg: known, relation, options: shuffle([...opts], rng), bearing }, true);
  return lvl;
}
