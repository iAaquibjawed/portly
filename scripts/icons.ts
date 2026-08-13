/**
 * Renders every icon asset from `shared/marks.ts` using Chromium, so the
 * gradient, the cast shadow and the superellipse are rasterised by the same
 * engine that drew the reviewed comparison sheet.
 *
 * Run with `npm run icons`.
 */
import { app, BrowserWindow, nativeImage } from 'electron'
import { execFileSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  APERTURE,
  APP_BODY_INSET,
  APP_CANVAS,
  APP_SQUIRCLE_N,
  CANDIDATES,
  MARK_GRID,
  TRAY_MARK,
  appMarkRects,
  markTemplateSvg,
  squirclePath,
  type Rect,
} from '../shared/marks'

const ROOT = join(__dirname, '..')
const ICON_DIR = join(ROOT, 'build', 'icons')
const SVG_DIR = join(ROOT, 'assets', 'tray')
const REVIEW_DIR = join(ROOT, 'mockups')

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/* ------------------------------------------------------------- colour ---- */

/** oklch -> sRGB bytes, so hues are derived from the token, never transcribed. */
function oklch(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b2 = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b2
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b2
  const s_ = L - 0.0894841775 * a - 1.291485548 * b2
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return lin.map((c) => {
    const v = Math.min(1, Math.max(0, c))
    const enc = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, enc)) * 255)
  }) as [number, number, number]
}

const hex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

function relativeLuminance([r, g, b]: [number, number, number]) {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: [number, number, number], b: [number, number, number]) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The mark. Teal, flat, no gradient. */
const TEAL = oklch(0.68, 0.14, 180)
/** The field. Dark, flat, a bare trace of the same hue so it is one family. */
const FIELD = oklch(0.19, 0.018, 180)

const MARK_HEX = hex(TEAL)
const FIELD_HEX = hex(FIELD)
const MARK_CONTRAST = contrast(TEAL, FIELD)

/* ---------------------------------------------------------------- PNG ---- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf: Buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width: number, height: number, rgba: Uint8Array) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(height * (1 + width * 4))
  let p = 0
  for (let y = 0; y < height; y++) {
    raw[p++] = 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      raw[p++] = rgba[i]
      raw[p++] = rgba[i + 1]
      raw[p++] = rgba[i + 2]
      raw[p++] = rgba[i + 3]
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function encodeIco(entries: { size: number; data: Buffer }[]) {
  const dir = Buffer.alloc(6 + entries.length * 16)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(entries.length, 4)
  let offset = dir.length
  entries.forEach(({ size, data }, i) => {
    const e = 6 + i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, e)
    dir.writeUInt8(size >= 256 ? 0 : size, e + 1)
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(data.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([dir, ...entries.map((e) => e.data)])
}

/* --------------------------------------------------------- rasterising ---- */

async function rasterise(html: string, cssSize: number, target: number) {
  const win = new BrowserWindow({
    width: cssSize,
    height: cssSize,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { backgroundThrottling: false },
  })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await wait(500)
  let image = await win.webContents.capturePage()
  if (image.getSize().width !== target) {
    image = image.resize({ width: target, height: target, quality: 'best' })
  }
  win.destroy()
  return image
}

const page = (body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
   html,body{margin:0;padding:0;background:transparent;overflow:hidden}
   svg{display:block}</style></head><body>${body}</body></html>`

/** Tray mask: the winning mark, flat, in one colour. */
function trayHtml(colour: string, size: number) {
  return page(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${MARK_GRID} ${MARK_GRID}"` +
      ` style="color:${colour}">${TRAY_MARK.svg}</svg>`,
  )
}

const rectsSvg = (rects: Rect[], fill: string) =>
  rects
    .map(
      (r) =>
        `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.r}" fill="${fill}"/>`,
    )
    .join('')

/**
 * App icon. Apple's Big Sur grid: 1024 canvas, 824 body, so a 100pt inset.
 * Flat teal mark on a flat field, plus exactly one soft shadow cast by the mark
 * onto the field from a single upper-left light source. No gradient anywhere, no
 * bevel, no rim light, no inner glow.
 */
function appIconHtml(size: number) {
  const inset = APP_CANVAS * APP_BODY_INSET
  const half = (APP_CANVAS - inset * 2) / 2
  const body = squirclePath(APP_CANVAS / 2, APP_CANVAS / 2, half, APP_SQUIRCLE_N)
  const marks = rectsSvg(appMarkRects(APP_CANVAS), MARK_HEX)
  // One light source, upper left, so the mark casts down and to the right.
  const dx = APP_CANVAS * 0.009
  const dy = APP_CANVAS * 0.013
  const blur = APP_CANVAS * 0.017

  return page(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${APP_CANVAS} ${APP_CANVAS}">
      <defs>
        <filter id="cast" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${blur}"
            flood-color="#000000" flood-opacity="0.42"/>
        </filter>
        <clipPath id="bodyClip"><path d="${body}"/></clipPath>
      </defs>
      <path d="${body}" fill="${FIELD_HEX}"/>
      <g clip-path="url(#bodyClip)"><g filter="url(#cast)">${marks}</g></g>
    </svg>`,
  )
}

/* ------------------------------------------------------- review strip ---- */

/** BGRA from NativeImage -> RGBA, composited onto one canvas. */
function blit(
  dst: Uint8Array,
  dstW: number,
  image: Electron.NativeImage,
  atX: number,
  atY: number,
) {
  const { width, height } = image.getSize()
  const src = image.toBitmap()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4
      const d = ((atY + y) * dstW + (atX + x)) * 4
      const a = src[s + 3] / 255
      // Source-over onto whatever the strip background already holds.
      for (let c = 0; c < 3; c++) {
        const sc = src[s + (2 - c)] // BGRA -> RGB
        dst[d + c] = Math.round(sc * a + dst[d + c] * (1 - a))
      }
      dst[d + 3] = Math.round(255 * a + dst[d + 3] * (1 - a))
    }
  }
}

const STRIP_SIZES = [128, 64, 32, 16]

/** Two backdrops, because an icon is judged on both Finder backgrounds. */
const STRIP_BACKDROPS: { name: string; rgb: [number, number, number] }[] = [
  { name: 'light', rgb: [246, 246, 248] },
  { name: 'dark', rgb: [32, 32, 36] },
]

function buildStrip(images: Map<number, Electron.NativeImage>) {
  const pad = 20
  const gap = 20
  const rowH = 128 + pad * 2
  const width = pad * 2 + STRIP_SIZES.reduce((a, s) => a + s, 0) + gap * (STRIP_SIZES.length - 1)
  const height = rowH * STRIP_BACKDROPS.length
  const rgba = new Uint8Array(width * height * 4)

  STRIP_BACKDROPS.forEach((backdrop, row) => {
    for (let y = row * rowH; y < (row + 1) * rowH; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        rgba[i] = backdrop.rgb[0]
        rgba[i + 1] = backdrop.rgb[1]
        rgba[i + 2] = backdrop.rgb[2]
        rgba[i + 3] = 255
      }
    }
    let x = pad
    for (const size of STRIP_SIZES) {
      const image = images.get(size)
      if (image) blit(rgba, width, image, x, row * rowH + pad + (128 - size) / 2)
      x += size + gap
    }
  })

  return encodePng(width, height, rgba)
}

/* ---------------------------------------------------------------- run ---- */

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide()
  mkdirSync(ICON_DIR, { recursive: true })
  mkdirSync(SVG_DIR, { recursive: true })
  mkdirSync(REVIEW_DIR, { recursive: true })

  try {
    // Reviewed candidates, kept as template SVGs for the record.
    for (const mark of CANDIDATES) {
      writeFileSync(join(SVG_DIR, `${mark.id}.svg`), `${markTemplateSvg(mark)}\n`)
    }
    writeFileSync(join(SVG_DIR, 'trayIconTemplate.svg'), `${markTemplateSvg(TRAY_MARK)}\n`)
    console.log(`icons: ${CANDIDATES.length + 1} template SVGs -> assets/tray/`)

    // macOS template masks: pure black, alpha carries the shape.
    for (const [name, size] of [
      ['trayIconTemplate.png', 16],
      ['trayIconTemplate@2x.png', 32],
      ['trayIconTemplate@3x.png', 48],
    ] as const) {
      const image = await rasterise(trayHtml('#000000', size), size, size)
      writeFileSync(join(ICON_DIR, name), image.toPNG())
      console.log(`icons: ${name} (${size}×${size} template mask)`)
    }

    // Windows and Linux have no template concept: monochrome white.
    for (const [name, size] of [
      ['trayIconWin.png', 16],
      ['trayIconWin@2x.png', 32],
    ] as const) {
      const image = await rasterise(trayHtml('#ffffff', size), size, size)
      writeFileSync(join(ICON_DIR, name), image.toPNG())
      console.log(`icons: ${name} (${size}×${size} monochrome)`)
    }

    // App icon: one 1024 master, every size resized from it, so the downscale
    // strip shows the actual icon shrinking rather than being redrawn.
    const master = await rasterise(appIconHtml(APP_CANVAS), APP_CANVAS, APP_CANVAS)
    const sizes = new Map<number, Electron.NativeImage>([[APP_CANVAS, master]])
    for (const size of [512, 256, 128, 64, 32, 16]) {
      sizes.set(size, master.resize({ width: size, height: size, quality: 'best' }))
    }

    writeFileSync(join(REVIEW_DIR, 'app-icon-scales.png'), buildStrip(sizes))
    console.log(
      `icons: mark ${MARK_HEX} on field ${FIELD_HEX}, contrast ` +
        `${MARK_CONTRAST.toFixed(2)}:1 -> mockups/app-icon-scales.png`,
    )

    const chosen = sizes
    writeFileSync(join(ICON_DIR, 'appIcon.png'), chosen.get(512)!.toPNG())
    writeFileSync(join(ICON_DIR, 'appIcon-1024.png'), chosen.get(1024)!.toPNG())
    console.log('icons: appIcon.png (512) + appIcon-1024.png')

    const icoSizes = [16, 32, 48, 64, 128, 256]
    const icoEntries = await Promise.all(
      icoSizes.map(async (size) => ({
        size,
        data: (chosen.get(size) ??
          chosen.get(1024)!.resize({ width: size, height: size, quality: 'best' })).toPNG(),
      })),
    )
    writeFileSync(join(ICON_DIR, 'Portly.ico'), encodeIco(icoEntries))
    console.log(`icons: Portly.ico (${icoSizes.join(', ')})`)

    const iconset = join(ICON_DIR, 'Portly.iconset')
    rmSync(iconset, { recursive: true, force: true })
    mkdirSync(iconset, { recursive: true })
    for (const [name, size] of [
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024],
    ] as const) {
      const image =
        chosen.get(size) ?? master.resize({ width: size, height: size, quality: 'best' })
      writeFileSync(join(iconset, name), image.toPNG())
    }
    try {
      execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(ICON_DIR, 'Portly.icns')])
      console.log('icons: Portly.icns')
    } catch {
      console.log('icons: skipped Portly.icns (iconutil unavailable) — iconset kept')
    }

    console.log(
      `icons: mark oklch(0.68 0.14 180) = ${MARK_HEX}, ` +
        `field oklch(0.19 0.018 180) = ${FIELD_HEX}, aperture ${(APERTURE * 100).toFixed(0)}%`,
    )
    app.exit(0)
  } catch (err) {
    console.error('icons failed:', err)
    app.exit(1)
  }
})

// Never let a stray window keep the process alive.
app.on('window-all-closed', () => {})
