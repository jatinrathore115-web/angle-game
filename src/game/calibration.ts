import calib from './assetCalibration.json';
import { DEG } from './AngleMath';

/** Logical stage (all game coordinates are in these units). */
export const STAGE_W = 1920;
export const STAGE_H = 1080;

/** Turret pivot = centre of the base's red core socket. */
export const TURRET = { x: 960, y: 535 };

/** Supplied art is 1672x941; it maps onto the 1920x1080 stage (aspect differs by 0.06%). */
export const ART_SX = STAGE_W / calib.frame.w;
export const ART_SY = STAGE_H / calib.frame.h;

/** Inner edge of the supplied frame in stage units (measured from the alpha channel). */
export const FRAME_INNER = {
  left: calib.frame.inner.left * ART_SX,
  right: calib.frame.inner.right * ART_SX,
  top: calib.frame.inner.top * ART_SY,
  bottom: calib.frame.inner.bottom * ART_SY,
};

/** Rectangle meteors may spawn in (well inside the frame, clear of the button row). */
export const SPAWN_RECT = { left: 200, right: 1720, top: 150, bottom: 760 };

// ---------- turret base ----------
export const BASE_IMG = { w: calib.base.w, h: calib.base.h };
export const BASE_SCALE = 0.19;
export const BASE_CORE = calib.base.core; // image px of the red socket centre
export const BASE_RADIUS = (calib.base.alphaBounds.w * BASE_SCALE) / 2; // ~110

// ---------- barrel ----------
export const BARREL_IMG = { w: calib.barrel.w, h: calib.barrel.h };
export const BARREL_SCALE = 0.105;
/**
 * Rear pivot in barrel-image pixels: just inside the glowing rear cap (~9% of the
 * image width, ~4% behind the hex nut) so the cap sits on the red socket.
 */
export const BARREL_PIVOT = { x: 200, y: 375 };
export const BARREL_MUZZLE = { x: calib.barrel.muzzle.x, y: calib.barrel.muzzle.y };
/** The art's bore axis is very slightly tilted; compensate so the muzzle lies exactly on the aim ray. */
export const BARREL_TILT_DEG =
  Math.atan2(BARREL_MUZZLE.y - BARREL_PIVOT.y, BARREL_MUZZLE.x - BARREL_PIVOT.x) / DEG;
export const MUZZLE_DIST =
  Math.hypot(BARREL_MUZZLE.x - BARREL_PIVOT.x, BARREL_MUZZLE.y - BARREL_PIVOT.y) * BARREL_SCALE;

// ---------- meteor sheet ----------
export const METEOR_SHEET = calib.meteor;
export const METEOR_COLS = calib.meteor.cols;
export const METEOR_ROWS = calib.meteor.rows;
export const METEOR_FRAME_COUNT = METEOR_COLS * METEOR_ROWS;
/** The sheet art travels toward this screen angle (principal axis of the long-tail frames). */
export const METEOR_ART_ANGLE = calib.meteor.artAngleDeg;
/** Frames 0..11 ignite (tail grows); 12..29 are a stable long-tail burn we ping-pong through. */
export const METEOR_INTRO_END = 11;
export const METEOR_LOOP_START = 12;
export const METEOR_FPS = 15;
/** Where the meteor head "hits" the shield (stage px from turret centre). */
export const IMPACT_RADIUS = 128;
