export type Relation = 'linear-pair' | 'vertical';
export type TurnSign = 1 | -1;

export interface Vec2 {
  x: number;
  y: number;
}

/** One angle problem. All bearings are screen degrees (0 = +X/right, clockwise positive because +Y is down). */
export interface LevelDef {
  id: number;
  label: string;
  knownDeg: number;
  relation: Relation;
  options: number[];
  /** Bearing from the turret to the meteor (meteor flies radially, so this stays constant). */
  targetBearingDeg: number;
  turnSign: TurnSign;
  speedTier: number;
  mastery?: boolean;
}

export interface Arc {
  startDeg: number;
  /** signed sweep, positive = clockwise on screen */
  sweepDeg: number;
}

/** The full geometry of an active question. Rendering AND shooting both read from this. */
export interface QuestionGeometry {
  targetBearingDeg: number;
  referenceRayBearingDeg: number;
  turnSign: TurnSign;
  answerDeg: number;
  knownDeg: number;
  relation: Relation;
  unknownArc: Arc;
  knownArc: Arc;
  /** bearings of the four rays drawn (two straight lines through the turret) */
  rays: number[];
}

export type Difficulty = 'normal' | 'calm';
export type Quality = 'high' | 'medium' | 'low';

export interface Settings {
  volume: number;
  muted: boolean;
  difficulty: Difficulty;
  quality: Quality;
}
