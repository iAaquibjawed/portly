import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = dirname(fileURLToPath(import.meta.url))

// Separate build so the mockup page never ships inside the app bundle.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-mockups',
    emptyOutDir: true,
    assetsDir: '.',
    rollupOptions: {
      input: {
        mockup: resolve(here, 'mockup.html'),
        traycompare: resolve(here, 'traycompare.html'),
        hero: resolve(here, 'hero.html'),
      },
    },
  },
})
