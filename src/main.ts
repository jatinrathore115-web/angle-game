import { loadAssets } from './game/AssetLoader';
import { Game } from './game/Game';
import { ResponsiveStage } from './game/ResponsiveStage';

const viewport = document.getElementById('viewport')!;
const stage = document.getElementById('game-stage')!;

// Lay the stage out immediately so the loading card is correctly scaled.
const bootStage = new ResponsiveStage(viewport, stage);

const loadText = document.getElementById('load-text')!;
const loadBar = document.getElementById('load-bar')!;

// Start screen art is requested before the game assets so it appears first.
const splashArt = document.getElementById('splash-art') as HTMLImageElement;
const startImg = document.getElementById('start-btn-img') as HTMLImageElement;
splashArt.addEventListener('load', () => stage.classList.add('splash-ready'), { once: true });
splashArt.addEventListener('error', () => stage.classList.add('splash-ready'), { once: true }); // fall back to the plain dark panel
splashArt.src = `${import.meta.env.BASE_URL}assets/start-thumbnail.png`;
startImg.src = `${import.meta.env.BASE_URL}assets/start-button.png`;

// prevent page scroll / pinch / long-press selection during play
for (const ev of ['touchmove', 'gesturestart', 'contextmenu'] as const) {
  stage.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false }); // no double-tap zoom
// iOS only applies :active (instant pressed feedback) when a touch listener exists
document.addEventListener('touchstart', () => {}, { passive: true });

// Hover effects only where a real hover exists, so they never "stick" after a tap.
const hoverMq = window.matchMedia('(hover: hover) and (pointer: fine)');
const syncHover = () => document.documentElement.classList.toggle('can-hover', hoverMq.matches);
syncHover();
hoverMq.addEventListener('change', syncHover);

loadAssets((done, total) => {
  loadBar.style.transform = `scaleX(${done / total})`;
  loadText.textContent = `Loading… ${Math.round((done / total) * 100)}%`;
})
  .then((assets) => {
    bootStage.destroy();
    (document.getElementById('bg') as HTMLImageElement).src = assets.background.src;
    (document.getElementById('frame') as HTMLImageElement).src = assets.frame.src;
    (document.getElementById('frame-glow') as HTMLImageElement).src = assets.frame.src;
    // letterbox bars (other aspect ratios) show a dimmed copy of the backdrop, not flat black
    viewport.style.backgroundImage = `linear-gradient(rgba(4,6,15,0.62), rgba(4,6,15,0.62)), url("${assets.background.src}")`;
    const game = new Game(stage, viewport, assets);
    game.ui.setReady();
    loadText.textContent = 'Ready.';
    stage.classList.add('loaded');
    (window as unknown as { __game: Game }).__game = game;
  })
  .catch((err: Error) => {
    loadText.textContent = `⚠ ${err.message}. Please check the files and reload.`;
    document.getElementById('title-card')!.classList.add('error');
    console.warn(err);
  });
