# Face Cam VR

Face Cam VR is a browser-based player that makes VR videos look striking on phones and PCs with face-cam views.

It renders 180, 360, side-by-side, top-bottom, fisheye, and flat video formats into a 2D desktop browser view. It is not intended for VR headsets, WebXR sessions, Cardboard, Quest, or other immersive headset runtimes.

## Features

- Plays local video files directly in the browser.
- Supports common VR video projection presets for 2D monitor viewing.
- Uses face-aware auto-centering to keep the subject framed.
- Provides keyboard, mouse, and on-screen playback controls.
- Includes quality presets for performance and sharper desktop rendering.

## Usage

Open the app in a desktop browser on a flat monitor, then choose a video file with the file picker.

Recommended browsers:

- Chrome
- Edge or another Chromium-based browser

For the best experience, use Chrome or another Chromium-based browser with WebGL enabled. Safari and Firefox are not supported.

## Development

```sh
bun install
bun run dev
```

Build a production bundle:

```sh
bun run build
```

Run TypeScript checks:

```sh
bun run typecheck
```

## Deployment

Deploy with Cloudflare Pages by importing the GitHub repository directly.

- Repository: `ourongxing/face-cam-vr`
- Production branch: `main`
- Framework preset: `Vite`
- Build command: `bun run build`
- Build output directory: `dist`
- Production URL: https://facecam.busiyi.world/

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| Space / K | Play or pause |
| Left / J | Seek backward 10 seconds |
| Right / L | Seek forward 10 seconds |
| Shift + Left / Shift + J | Seek backward 60 seconds |
| Shift + Right / Shift + L | Seek forward 60 seconds |
| Up / Down | Adjust volume |
| M | Mute or unmute |
| F | Toggle fullscreen |
| V | Toggle video-only mode |
| R | Reset view and zoom |
| [ / - | Zoom out |
| ] / = | Zoom in |
| 1-7 | Select projection preset |
| , / . | Previous or next quality preset |

## Scope

Face Cam VR is a 2D monitor viewer for VR content. Headset support, stereoscopic headset output, and WebXR device compatibility are outside the project scope.

## Feedback

Please open issues at https://github.com/ourongxing/face-cam-vr/issues.
