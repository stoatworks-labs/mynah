import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Static SPA. No backend: the browser talks to the switcher directly.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(`v${pkg.version}`) },
  plugins: [
    react(),
    {
      // The support footer reads data-version off its own script tag, and Vite's
      // `define` only reaches JavaScript — index.html is copied verbatim. This
      // substitutes the one placeholder so a bug report says which build it came
      // from without the version being hand-maintained in two places.
      name: 'mynah-app-version',
      transformIndexHtml: (html: string) => html.replace(/__APP_VERSION__/g, `v${pkg.version}`),
    },
  ],
  base: './',
  // Pinned so the preview harness and the dev server agree on a port.
  server: { port: 5174, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
})
