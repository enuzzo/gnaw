# Download the app

Gnaw ships as a self-contained macOS app: a universal (Apple Silicon + Intel)
`.app` bundle with its own Node.js runtime and the compiled engine baked in.
You do not need Node, npm, or a repo checkout to run it.

## Install

1. Download `Gnaw.dmg`.
2. Open the DMG and drag **Gnaw** onto the **Applications** folder shortcut
   in that window.
3. Eject the DMG.

## First launch (one time per Mac)

Gnaw is a free, unsigned app, so macOS's Gatekeeper will ask you to confirm
it the first time you open it. You only do this once per Mac — after that it
opens normally, like any other app. See
[`FIRST-LAUNCH.txt`](FIRST-LAUNCH.txt) for the same steps in the form
that ships alongside the DMG.

1. Open **Applications** and double-click **Gnaw**. macOS will say it can't
   verify the app.
2. Open  Menu → **System Settings** → **Privacy & Security**.
3. Scroll down to the message about "Gnaw" and click **Open Anyway**.
4. Confirm. Gnaw opens, and stays trusted on this Mac from now on.

## Browser engine (Chromium)

Gnaw captures sites through a real Chromium-family browser. On first
capture:

- If you already have Google Chrome, Microsoft Edge, or Chromium installed,
  Gnaw reuses it — nothing to download.
- If none is found, Gnaw asks before it downloads one automatically: a
  one-time ~150MB Chromium download with a spinner and status message, cached under
  `~/Library/Application Support/Gnaw/browsers` for all future captures.

This check and download are driven by the bundled engine's own
`gnaw browser check` / `gnaw browser ensure` commands — the app doesn't
implement browser discovery itself, it shells out to the engine it carries.

## Node.js is not required

The packaged app bundles its own Node.js runtime under
`Gnaw.app/Contents/Resources/node`, so installing Node.js system-wide is
**not** necessary to run Gnaw from the DMG. Node is only needed if you are
building Gnaw from source (see the top-level [`README.md`](../../README.md)
for the development workflow).
