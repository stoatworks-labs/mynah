import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Static SPA. No backend: the browser talks to the switcher directly.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(`v${pkg.version}`) },
  plugins: [react()],
  base: './',
  // Pinned so the preview harness and the dev server agree on a port.
  server: { port: 5174, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
})
