// Dev runner: Vite dev server for the renderer, esbuild watch for main/preload,
// then Electron pointed at the dev server. No extra deps.
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const DEV_URL = 'http://localhost:5273'
const children = []

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts })
  children.push(child)
  return child
}

function shutdown(code = 0) {
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM')
  }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

await once(run('node', ['scripts/make-icons.mjs']), 'exit')
await once(run('node', ['scripts/build-electron.mjs', '--watch']), 'spawn')

run('npx', ['vite'])

// Wait for the dev server to answer before booting Electron, so the window
// never opens on a connection error.
const deadline = Date.now() + 30_000
for (;;) {
  try {
    const res = await fetch(DEV_URL)
    if (res.ok) break
  } catch {
    // not up yet
  }
  if (Date.now() > deadline) {
    console.error('dev: Vite did not start within 30s')
    shutdown(1)
  }
  await new Promise((r) => setTimeout(r, 250))
}

const electron = run('npx', ['electron', '.'], {
  env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
})
electron.on('exit', (code) => shutdown(code ?? 0))
