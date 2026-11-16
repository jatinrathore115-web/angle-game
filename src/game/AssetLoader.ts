export const ASSET_FILES = {
  background: 'assets/space-background.png',
  frame: 'assets/space-frame.png',
  base: 'assets/turret-base.png',
  barrel: 'assets/turret-barrel.png',
  meteor: 'assets/meteor-30frame.png',
} as const;

export type AssetKey = keyof typeof ASSET_FILES;
export type Assets = Record<AssetKey, HTMLImageElement>;

/** Preload every runtime image with real progress; rejects with a readable message. */
export function loadAssets(onProgress: (done: number, total: number) => void): Promise<Assets> {
  const keys = Object.keys(ASSET_FILES) as AssetKey[];
  let done = 0;
  onProgress(0, keys.length);
  const base = import.meta.env.BASE_URL;
  return Promise.all(
    keys.map(
      (k) =>
        new Promise<[AssetKey, HTMLImageElement]>((resolve, reject) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = async () => {
            try {
              await img.decode();
            } catch {
              /* decode() unsupported or not needed */
            }
            done++;
            onProgress(done, keys.length);
            resolve([k, img]);
          };
          img.onerror = () => reject(new Error(`Could not load ${ASSET_FILES[k]}`));
          img.src = base + ASSET_FILES[k];
        }),
    ),
  ).then((pairs) => Object.fromEntries(pairs) as Assets);
}
