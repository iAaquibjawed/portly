// Bundles the Electron main + preload to CommonJS. The package is type:module
// for Vite's sake, so these emit as .cjs to stay loadable by Electron.
import { build } from 'esbuild'

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
}

const watch = process.argv.includes('--watch')

const targets = [
  { entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' },
  { entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' },
]

if (watch) {
  const { context } = await import('esbuild')
  for (const t of targets) {
    const ctx = await context({ ...shared, ...t })
    await ctx.watch()
  }
  console.log('electron: watching')
} else {
  await Promise.all(targets.map((t) => build({ ...shared, ...t })))
}
