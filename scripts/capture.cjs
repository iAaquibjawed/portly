/**
 * Renders the mockup sheet offscreen and writes a PNG.
 *
 * Uses webContents.capturePage(), which reads the renderer's own surface rather
 * than the display, so it needs no screen-recording permission and works
 * headless. Run via `npm run mockup`.
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const PAGE = join(__dirname, '..', 'dist-mockups', arg('page', 'mockup.html'))
const OUT = join(__dirname, '..', 'mockups', arg('out', 'portly-states.png'))
// 2x so 11px type is legible in the captured file.
const SCALE = Number(arg('scale', '2'))
const MEASURE = arg('measure', 'states')

app.commandLine.appendSwitch('force-device-scale-factor', String(SCALE))
app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide()

  if (!existsSync(PAGE)) {
    console.error(`capture: ${PAGE} missing — run the mockup build first`)
    app.exit(1)
    return
  }

  const win = new BrowserWindow({
    width: 1400,
    height: 820,
    show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  })

  try {
    await win.loadFile(PAGE)
    // Let fonts settle, then the simulated-hover pass at 400ms, then paint.
    await new Promise((r) => setTimeout(r, 2000))

    // Size the window to the sheet so nothing is cropped.
    const size = await win.webContents.executeJavaScript(
      `(() => {
        // Pages define their own wrapper; fall back to the document.
        const s = document.querySelector('.sheet, .hero') || document.body;
        const r = s.getBoundingClientRect();
        return { w: Math.ceil(r.width + 56), h: Math.ceil(r.height + 56) } })()`,
    )
    win.setContentSize(size.w, size.h)
    await new Promise((r) => setTimeout(r, 800))

    // Verify the geometry claims instead of eyeballing them in the PNG.
    const geom = MEASURE !== 'states' ? null : await win.webContents.executeJavaScript(
      `(() => {
        const panel = (k) => document.querySelector('[data-panel-key="' + k + '"]');
        const rowsOf = (k) => [...panel(k).querySelectorAll('.row')];
        const railRight = (r) => { const b = r.querySelector('.rail').getBoundingClientRect();
          return { w: Math.round(b.width), right: Math.round(b.right) } };
        const slotXs = (r) => [...r.querySelectorAll('.rail-slot')]
          .map(s => Math.round(s.getBoundingClientRect().left));
        const rest = rowsOf('rest'), non = rowsOf('nonhttp');
        return {
          rowHeights: rest.map(r => Math.round(r.getBoundingClientRect().height)),
          railWidths: rest.map(r => railRight(r).w),
          railRights: rest.map(r => railRight(r).right),
          slotsHttp: slotXs(non[2]),
          slotsNonHttp: slotXs(non[0]),
          openPresentHttp: !!non[2].querySelector('[data-role=open]'),
          openPresentNonHttp: !!non[0].querySelector('[data-role=open]'),
          stopOpacityRest: getComputedStyle(rest[0].querySelector('[data-role=stop]')).opacity,
          stopOpacityHovered: getComputedStyle(
            rowsOf('hover')[1].querySelector('[data-role=stop]')).opacity,
          confirmRowHeights: rowsOf('confirm').map(r => Math.round(r.getBoundingClientRect().height)),
          stoppedRowHeights: rowsOf('stopped').map(r => Math.round(r.getBoundingClientRect().height)),
          stoppedRowIndex: rowsOf('stopped').findIndex(r => r.dataset.state === 'stopped'),
          stoppedPortOrder: rowsOf('stopped').map(r =>
            (r.querySelector('.row-anchor') || r.querySelector('.row-port')).textContent),
          startPresentOnStopped: !!rowsOf('stopped')[1].querySelector('[data-role=start]'),
          openPresentOnStopped: !!rowsOf('stopped')[1].querySelector('[data-role=open]'),
        } })()`,
    )
    if (geom) console.log('geometry:', JSON.stringify(geom, null, 1))

    const image = await win.webContents.capturePage()
    if (image.isEmpty()) {
      console.error('capture: captured image was empty')
      app.exit(1)
      return
    }
    writeFileSync(OUT, image.toPNG())
    const { width, height } = image.getSize()
    console.log(`capture: wrote ${OUT} (${width}x${height})`)
    app.exit(0)
  } catch (err) {
    console.error('capture failed:', err)
    app.exit(1)
  }
})
