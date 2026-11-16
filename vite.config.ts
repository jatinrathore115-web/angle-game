import { defineConfig, type Plugin } from 'vite';

/**
 * Make the production build open straight from disk (double-click dist/index.html).
 * Browsers block `type="module"` scripts and `crossorigin` stylesheets on file://
 * pages (origin "null"), so the build emits one classic IIFE script, loaded with
 * `defer`, and strips the crossorigin attributes. Images are plain <img>/Image
 * loads, which file:// allows.
 */
function fileProtocolFriendly(): Plugin {
  return {
    name: 'file-protocol-friendly',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin src=/g, '<script defer src=')
        .replace(/<script type="module" src=/g, '<script defer src=')
        .replace(/ crossorigin(?=[ >])/g, '');
    },
  };
}

export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  plugins: [fileProtocolFriendly()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    modulePreload: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
  test: { environment: 'node', include: ['src/tests/**/*.test.ts'] },
} as any);
