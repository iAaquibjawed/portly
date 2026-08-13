/**
 * Repairs an Electron install whose binary never unpacked.
 *
 * Electron's own postinstall uses extract-zip, which fails silently on some
 * macOS setups (it leaves a partial `dist/` and no `path.txt`, so `electron .`
 * dies with "Electron failed to install correctly"). The downloaded zip in the
 * cache is fine, so this re-extracts it with the system `unzip` and writes the
 * `path.txt` that Electron's index.js looks for.
 *
 * Run it if `npm start` reports that Electron failed to install.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')

if (!existsSync(electronDir)) {
  console.error('fix-electron: node_modules/electron is missing — run `npm install` first')
  process.exit(1)
}

const { version } = JSON.parse(readFileSync(join(electronDir, 'package.json'), 'utf8'))

const PLATFORM_PATHS = {
  darwin: 'Electron.app/Contents/MacOS/Electron',
  linux: 'electron',
  win32: 'electron.exe',
}
const platformPath = PLATFORM_PATHS[process.platform]
if (!platformPath) {
  console.error(`fix-electron: unsupported platform ${process.platform}`)
  process.exit(1)
}

const distDir = join(electronDir, 'dist')
const pathTxt = join(electronDir, 'path.txt')

function alreadyGood() {
  try {
    if (readFileSync(join(distDir, 'version'), 'utf8').replace(/^v/, '') !== version) return false
    if (readFileSync(pathTxt, 'utf8') !== platformPath) return false
    return existsSync(join(distDir, platformPath))
  } catch {
    return false
  }
}

if (alreadyGood()) {
  console.log(`fix-electron: electron ${version} is already unpacked — nothing to do`)
  process.exit(0)
}

const cacheRoot =
  process.env.electron_config_cache ??
  (process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Caches', 'electron')
    : join(homedir(), '.cache', 'electron'))

const zipName = `electron-v${version}-${process.platform}-${process.arch}.zip`

function findZip() {
  if (!existsSync(cacheRoot)) return null
  for (const entry of readdirSync(cacheRoot)) {
    const candidate = join(cacheRoot, entry, zipName)
    if (existsSync(candidate)) return candidate
  }
  return null
}

let zip = findZip()

if (!zip) {
  console.log(`fix-electron: ${zipName} not cached — downloading via electron's installer`)
  // install.js populates the cache even when its extract step then fails.
  spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
  zip = findZip()
}

if (!zip) {
  console.error(`fix-electron: could not obtain ${zipName}`)
  process.exit(1)
}

console.log(`fix-electron: extracting ${zip}`)
rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })

const result = spawnSync('unzip', ['-q', '-o', zip, '-d', distDir], { stdio: 'inherit' })
if (result.status !== 0) {
  console.error('fix-electron: unzip failed')
  process.exit(1)
}

writeFileSync(pathTxt, platformPath)

if (!alreadyGood()) {
  console.error('fix-electron: extraction finished but the install still looks wrong')
  process.exit(1)
}

console.log(`fix-electron: electron ${version} unpacked successfully`)
