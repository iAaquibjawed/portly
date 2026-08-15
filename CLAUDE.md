# Portly — project context

## What this is

A macOS menu-bar app that answers one question: **which of my local projects is
running on which port.** No Dock icon, no window — a popover in the menu bar, plus
a `portly` CLI that answers the same question in a terminal.

Electron + React + TypeScript (strict). macOS only in practice: it shells out to
`lsof`, `ps`, `git` and `iconutil`.

## The problem it solves

A developer with eight servers running has no idea which is which. `lsof -i :3000`
returns a PID and a process name — `node`, `ruby`, `node` again — which is what
they already knew. The missing fact is *whose* server it is.

Portly resolves every listener to the **git repository** it runs out of, groups the
ports by project, and lets the user open, stop, or restart any of them. It also
classifies what stopping something would cost, so killing Vite and killing Postgres
do not look identical.

Who it helps: anyone juggling multiple local services, and anyone who just hit
`EADDRINUSE` and wants to know what to kill without guessing.

## How it works

1. `lsof -nP -iTCP -sTCP:LISTEN -FpcnL` lists listeners; rows collapse by `port + pid`.
2. `ps` supplies uptime, argv and RSS.
3. The listener's cwd resolves to a git root, which becomes the project name.
4. Protocol is probed with a real HTTP then HTTPS request; the page `<title>` labels the row.
5. Rows group by the project's **absolute path**.

## Invariants — do not break these

- **Shape carries meaning, never colour.** Protocol is a filled dot / ringed dot /
  outline square / dashed ring, so the list survives grayscale. One accent hue
  exists and is reserved for focus rings and the active count.
- **Nothing reflows on hover.** The action rail is a fixed 76px, always reserved.
  A row that resizes or moves when the pointer enters it is a bug.
- **Row height is 58px in every state** — resting, hovered, confirming, stopped.
- **Absence over dead buttons.** If an action cannot work, render nothing in that
  slot. Never a disabled control.
- **Group by path, never by display name.** Names collide; paths do not.
- **A stopped row keeps its exact position** in its group until the port is serving
  again or the window elapses. It never moves to a separate section.
- **The port never truncates.** In the stop confirm the project name absorbs
  truncation instead — the port is the fact being verified.
- **Destructive actions are hover-only and confirm inline.** `SIGTERM` first,
  `SIGKILL` only after 1.5s.

## Hard-won facts

Each of these was found by diagnosing real data, and each looks like a bug if you
do not know it:

- **Rails/puma overwrites its own argv.** `ps` returns
  `puma 7.2.0 (tcp://0.0.0.0:3000) [backend]`, not a command. It is unrecoverable,
  so `electron/infer.ts` reads what the project *declares* (`bin/rails`, `manage.py`,
  `Procfile`, `package.json`) instead. Never `basename()` a process name — that
  mangles rewritten titles.
- **Vite binds IPv6 localhost by default.** Probing only `127.0.0.1` misreports it
  as non-HTTP. Probe the addresses lsof actually reported.
- **lsof truncates its command field at ~31 characters.** Use `ps -o comm=` for
  display names.
- **macOS blocks reading another process's environment** (`ps -E` returns nothing),
  so `PATH` cannot be recovered. Re-spawns go through `$SHELL -l -c`.
- **Page titles are not project names.** A row titled "Coplyx" in the
  `copyclipboard` repo is correct, not mis-grouped.

## Layout

```
electron/   main (tray, popover, IPC) · ports (scan/stop) · project (naming)
            restart (argv capture, spawn) · infer · risk · portless · exec
shared/     types.ts · marks.ts (tray mark geometry, one source for both scales)
src/        Popover.tsx · Row.tsx · icons.tsx · tokens.css · app.css
cli/        portly.ts — shares the scanner with the app
scripts/    icons.ts (Chromium rasteriser) · capture.cjs (review sheets)
```

## Verifying changes

`npm run typecheck` covers renderer and main. `npm run mockup` renders the real
components offscreen and **asserts geometry** — row heights, rail widths, slot
positions. Use it rather than eyeballing; screen-recording permission is often
unavailable, and the mockups render the shipping components with fixture data.

When something looks wrong on a real machine, **diagnose before changing code**.
In this project's history, most reported bugs turned out to be a different bug than
the one reported.
