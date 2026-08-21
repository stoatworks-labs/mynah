import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

/**
 * Bundle the language core on its own, for consumers outside this repo.
 *
 * The Companion module cannot import TypeScript and has no build step, so it
 * vendors the output of this. Bundling rather than hand-copying is the point:
 * a second transcription of the grammar would drift the first time a keyword
 * moved, and nothing would notice.
 */
const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  build: {
    outDir: 'dist-lang',
    emptyOutDir: true,
    lib: {
      entry: resolve(root, 'src/lang/index.ts'),
      formats: ['es'],
      fileName: () => 'mynah-lang.mjs',
    },
    // Readable output: this gets vendored and read by people debugging a
    // control surface at 2am, and it is small enough that size is irrelevant.
    minify: false,
    target: 'node22',
  },
})
