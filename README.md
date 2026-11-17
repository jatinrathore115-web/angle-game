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

## Responsive & touch

- **Stage:** a 1920×1080 logical stage, uniformly scaled with no distortion. Letterbox bars on other aspect ratios show a dimmed copy of the backdrop, and the layout respects phone notches (safe areas).
- **Small screens:** a `--ui` factor (CSS variable) enlarges the controls, HUD, angle labels and menus relative to the art, so answer buttons never fall below the 44 px touch minimum.
- **Portrait phones and tablets:** the game rotates itself to fill the screen, so it's playable immediately, even with rotation lock on. A desktop window in portrait just letterboxes.
- **Touch:** hover effects apply only on devices with a real hover, the pressed state works on iOS, and double-tap zoom, pinch, scroll and long-press are blocked.
- **QA:** `node scripts/qa-devices.mjs <outDir> [url]` runs 16 devices (phones, tablets, laptops, desktops, ultrawide) with touch emulation. It taps through a round on each and writes a contact sheet.

## Playing on a phone or tablet

A phone can't open files on your PC, so it has to load the game over Wi-Fi from your computer:

1. On the PC, run `npm run dev`. Vite prints a **Network** address, for example `http://10.157.126.30:5173/`.
2. Connect the phone to the **same Wi-Fi** and open that Network address in Safari or Chrome.
3. Keep the terminal open while playing.

If the phone can't connect, check two things:
- **Firewall:** Windows Firewall must allow Node.js on this network.
- **Wi-Fi isolation:** some office and guest networks block devices from reaching each other. In that case, use a phone hotspot or home Wi-Fi, or host the `dist/` folder on any static web host.

**Performance on mobile:** the game measures its own frame rate. On slow devices it switches to lighter rendering (no blend modes, animated blurs or glow overlays) and lowers quality step by step. Game time also stays real-time down to 10 fps, so slow devices never run in slow motion.

**Safari check:** `node scripts/qa-webkit.mjs <outDir> [url]` runs Playwright's WebKit (Safari engine) with real iPhone and iPad profiles. Install it first with `npx playwright-core install webkit`.
