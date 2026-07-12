# Foursmith VR


___Watch VR like TikTok LIVE___

> This might be the most enjoyable way to experience VR — no headset required, and no worries if you suffer from motion sickness. Sit back and enjoy!

## Usage

> [!Important]
> Most 8K VR videos may not play properly or smoothly in Safari or Firefox. All browsers on iOS are Safari under the hood.

Open [Foursmith VR](https://vr.foursmith.com/) in Chrome, Edge, or another Chromium-based desktop browser.

## Features

- Plays local 180°, 360°, side-by-side, top-bottom, fisheye, and flat videos.
- Converts VR video into an automatically framed 2D view.
- Keeps faces centered automatically.
- Works with browsers and browser extensions that provide live speech translation.
- Supports mouse, keyboard, and on-screen controls.
- Offers adjustable projection and quality presets.

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
| R | Reset view and zoom |
| [ / - | Zoom out |
| ] / = | Zoom in |
| 1-7 | Select projection preset |
| , / . | Previous or next quality preset |

## Deployment

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/foursmith/vr)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ffoursmith%2Fvr&root-directory=.)

## Development

```sh
bun install
bun run dev
```

```sh
bun run typecheck
bun run build
```

## Local media server

The Web app remains available as a standalone static deployment for browser-selected files. The optional `fsvr` executable embeds the same Web UI and adds local media directories plus DLNA discovery.

```sh
bun install
bun run cli:dev -- ~/Movies
```

Pass `--password <password>` to keep a stable password across restarts. Otherwise, `fsvr` generates and prints a random password. A link may include `?password=<password>` for sign-in; after validation, the Web UI removes it from the address bar and stores it in an HttpOnly authentication cookie.

`fsvr` opens its integrated Web UI at `http://127.0.0.1:4190`. To make the complete Web UI and API available to other devices on the LAN, pass `--host 0.0.0.0`; the CLI will print the available LAN addresses.

DLNA media servers are not scanned during startup by default. Pass `--dlna-scan` to discover them before opening the Web UI; manual scanning remains available in the Web UI.

Build the standalone executable, including Web assets, WASM, and face-tracking models:

```sh
bun run cli:build
./cli/dist/fsvr ~/Movies
```

The Web UI embedded in `fsvr` is built without the PWA manifest or service worker. The standalone official Web build keeps PWA support.
