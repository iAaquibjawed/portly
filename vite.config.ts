import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Electron loads the built renderer over file://, so assets must be relative.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: '.',
  },
  server: {
    port: 5273,
    strictPort: true,
  },
})
