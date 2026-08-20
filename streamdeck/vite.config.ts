import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

/**
 * The plugin and its property inspector are separate self-contained scripts —
 * Stream Deck loads them into different contexts — so they are built one at a
 * time as IIFE bundles. The grammar and the link are bundled in rather than
 * imported at runtime.
 *
 * `MYNAH_SD_ENTRY` picks which one; `npm run build:streamdeck` runs both.
 */
const entry = process.env.MYNAH_SD_ENTRY ?? 'plugin'
const OUT: Record<string, string> = { plugin: 'code', inspector: 'pi' }

export default defineConfig({
  // Paths resolve against this config, not the repo root it is invoked from.
  root: dirname(fileURLToPath(import.meta.url)),
  build: {
    outDir: `com.stoatworks.mynah.sdPlugin/${OUT[entry]}`,
    emptyOutDir: false,
    lib: {
      entry: `src/${entry}.ts`,
      formats: ['iife'],
      name: entry === 'plugin' ? 'MynahStreamDeck' : 'MynahInspector',
      fileName: () => `${entry}.js`,
    },
    // Stream Deck ships its own runtime, and a readable bundle is far easier
    // to debug on a machine you cannot attach a profiler to.
    minify: false,
  },
})
