# Angle Defense: Meteor Intercept

A Grade 9 lines-and-angles defense game. A meteor flies at the central turret, and the learner picks the missing angle from four options. **The number you choose is the angle the cannon turns from its reference ray.** If you pick the right angle, the bolt meets the meteor and it explodes. If you pick a wrong one, the bolt flies off at the wrong bearing and misses.

Built with Vite + TypeScript, HTML/CSS and Canvas 2D, with procedural Web Audio. There are no runtime dependencies and no network requests after load.

## Run

**Easiest:** run `npm install` then `npm run build` once, then double-click **`dist/index.html`**. The build is a classic script, so it works straight from disk with no server.

> Opening the root `index.html` by double-click or with VS Code Live Server also works: that page needs the Vite dev server to compile its TypeScript, so in those cases it automatically switches to the built `dist/index.html`. After changing code, run `npm run build` again so `dist/` stays current.

```bash
npm install
npm run dev      # live dev server at http://localhost:5173 (keep this terminal open)
npm test         # 42 unit tests (math, sprite sheet, pivot, scoring, audio safety)
npm run build    # type-check + production build into dist/
npm run analyze  # re-measure asset calibration -> src/game/assetCalibration.json
node scripts/qa-screenshots.mjs <outDir> [url] [layout|flow|slowmo|lose|mobile|all]
```

Controls: click or tap an answer, or press keys `1`–`4`. `H` shows a hint, `P`/`Esc` pauses (volume, mute, Calm mode and quality are in the pause menu), `M` mutes, and `Enter` starts or replays. In dev builds, `E` triggers a test explosion.

## How the maths drives the cannon (`src/game/AngleMath.ts`)

```
answer          = relation === 'linear-pair' ? 180 - known : known
referenceRay    = targetBearing - turnSign * answer
shotBearing(c)  = referenceRay  + turnSign * c        // c = the option clicked
```

- Meteors fly radially, so `targetBearing` stays constant while they approach.
- The rays and arcs on screen are drawn from the same `QuestionGeometry` object the gun uses, so the picture always matches the shot.
- Collision is a segment-vs-circle test against the meteor's rock head. The hit radius is capped below half the smallest angular gap between options, so a wrong answer can never connect, not even 89° vs 91°.

## Assets

The five supplied PNGs live in `public/assets/`. They are copied from `assets/` and renamed to the spec names. `reference/LAYOUT_TARGET.jpg` is used only for comparison.

| File | Notes |
|---|---|
| `meteor-30frame.png` | 1774×887 is not divisible by 6×5. Each cell edge is rounded separately, so cells tile exactly with no drift. Per-frame head anchors and the art's travel angle (21.4°) are measured from the alpha channel by `scripts/analyze-assets.mjs`. Playback runs frames 0→11 once (the tail ignites), then ping-pongs 12↔29. |
| `turret-barrel.png` | Rear pivot at image px (200, 375). A 0.27° tilt in the art's bore is compensated, so the muzzle lies exactly on the aim ray. |
| `turret-base.png` | Positioned by its measured red-core centre, not by the image centre. |

## Structure

`src/game/`:

- `Game.ts`: the orchestrator and main loop.
- `StateMachine.ts`: `TITLE → SPAWNING → QUESTION_ACTIVE → AIMING → FIRING → HIT/MISS → …`, with game-time timers so pausing freezes everything.
- `RoundState.ts`: scoring, input locks, lives.
- `LevelBank.ts`: 8 curated levels plus generated mastery levels.
- `Meteor.ts`, `Turret.ts` (servo motion), `Projectile.ts`.
- `GeometryOverlay.ts`: rays, arcs and labels.
- `VFX.ts`: the 4-phase explosion, using pooled Canvas particles (capped at 110) plus CSS-keyframed DOM elements.
- `AudioEngine.ts`: all sound is synthesised.
- `SceneRenderer.ts`: live CSS ambience.
- `UI.ts`, `ResponsiveStage.ts` (1920×1080 logical stage, letterboxed, DPR-aware canvases).

Styles are in `src/styles/`. Every named keyframe the effects use is in `fx.css`.
