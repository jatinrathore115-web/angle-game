import { loadAssets } from './game/AssetLoader';
import { Game } from './game/Game';
import { ResponsiveStage } from './game/ResponsiveStage';

const viewport = document.getElementById('viewport')!;
const stage = document.getElementById('game-stage')!;

// Lay the stage out immediately so the loading card is correctly scaled.
const bootStage = new ResponsiveStage(viewport, stage);

const loadText = document.getElementById('load-text')!;
const loadBar = document.getElementById('load-bar')!;

// prevent page scroll / pinch / long-press selection during play
for (const ev of ['touchmove', 'gesturestart', 'contextmenu'] as const) {
  stage.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

loadAssets((done, total) => {
  loadBar.style.transform = `scaleX(${done / total})`;
  loadText.textContent = `Loading assets… ${Math.round((done / total) * 100)}%`;
})
  .then((assets) => {
    bootStage.destroy();
    (document.getElementById('bg') as HTMLImageElement).src = assets.background.src;
    (document.getElementById('frame') as HTMLImageElement).src = assets.frame.src;
    (document.getElementById('frame-glow') as HTMLImageElement).src = assets.frame.src;
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
