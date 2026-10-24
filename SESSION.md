# Session context

Written 24 Oct 2026 so a later chat in this repo can continue without the original conversation.

## What this is

`D:\CapCut` holds a stalled CapCut Android install plus **ClipLite**, a clean-room browser editor in `capcut-lite`. ClipLite is not a CapCut port. It is a small editor Minh can hand to a friend.

The live app is **https://lmhugn-hue.github.io/cliplite/**  
The public repo is **https://github.com/lmhugn-hue/cliplite** (account `lmhugn-hue`). GitHub Actions (`.github/workflows/pages.yml`) builds `dist/index.html` and publishes Pages on every push to `main`.

## CapCut investigation (do not resume as a clone)

Target was CapCut Android 19.9.0 (`com.lemon.lvoverseas`), split APKs in this workspace.

- Java/Kotlin in `com.vega.main` is readable (about 1,439 classes). About 9,150 SWIG wrappers in `com.vega.middlebridge.swig` match JNI exports in `libmiddle-bridge.so`.
- Rendering, effects, and AI live in large ARM64 libraries (`libcccreator.so`, `libmiddleware.so`). `libcapcut.so` is compressed.
- REA on this Windows machine cannot decompile those ELF libraries. Ghidra here accepts PE only. No WSL, IDA, or Kuna.
- Do not extract, decrypt, or redistribute CapCut Pro or paid effects, filters, stickers, transitions, or fonts. A logged-in Pro account does not make those assets reusable.

## ClipLite

Stack: Vite 8, React 19, TypeScript, `vite-plugin-singlefile`, mediabunny 1.62. One file: `dist/index.html`. WebGL2 compositor, IndexedDB (`cliplite`), undo/redo store.

Working features: import video, image, and audio; timeline trim, split, move; playback; the built-in Mau Nhat `.cube` LUT (`src/presets/maunhat.cube`, from `C:\Users\minhh\Downloads\maunhat.cube`); text; MP4 export via the browser encoder (recent Chrome or Edge). Projects stay in the visitor's browser.

Checked and not bugs: captions do render while playing; export frame colors match the timeline when decoded with mediabunny. An earlier blank-frame check had read the video element before it painted.

`gh` is installed at `C:\Program Files\GitHub CLI\gh.exe`. Shells opened before that install do not see `gh` until PATH is refreshed. GitHub CLI is logged in as `lmhugn-hue` with `repo` and `workflow`.

## Full Car text preset

`capcut-lite/Full Car/` is a CapCut text preset (41 caption styles from a 1080×1920 car video: Toyota, 2.5 TỶ, CHỐT XE, and the rest). The styles are in `src/presets/fullcar.ts` and show in the Text tab under **Full Car**.

The original fonts (SVN-Gilroy, SF Pro, under `/Users/hieuht28/Library/Fonts/`) are not in the browser. Bold lines use Arial; lighter lines use Segoe UI. Size is `capcutFontSize * clipScale * 1.5` so it matches a 9:16 frame (CapCut pixel size ≈ fontSize × scale × canvasHeight / 720). Each style has a black stroke and a soft shadow.

The raw `Full Car/` folder is still only on this PC. It is not in the public repo: `draft_content.json` contains a CapCut user id and local font paths. Do not commit that folder unless Minh asks.

## Local-only leftovers

- `debug/extract_fullcar.py` and `debug/selftest.ts` are scratch. Not required to run the app.
- IndexedDB name changed from `capcut-lite` to `cliplite`, so older local projects on this machine do not reload.
