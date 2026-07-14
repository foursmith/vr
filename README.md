# Foursmith VR


___Watch VR like TikTok___

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
bun run dev:cli -- ~/Movies
```

In this development mode, the Web UI runs on Vite at `http://127.0.0.1:4090` with hot module replacement, while CLI API and media requests are proxied to the local server on port `4191`. The development script passes `--disable-password`, so authentication is disabled. Changes to CLI server source files are applied with Bun's hot reloading. Pass `--open` to open the Web UI once after startup.

Pass `--password <password>` to keep a stable password across restarts, or `--disable-password` to disable authentication. Otherwise, `fsvr` generates and prints a random password. The CLI opens `/api/v1/auth?fsvr_password=<password>` for sign-in; after validation, the server stores it in an HttpOnly authentication cookie and redirects to the Web UI.

`fsvr` serves its integrated Web UI at `http://127.0.0.1:4090` without opening a browser by default. Pass `--open` to open it after startup. To make the complete Web UI and API available to other devices on the LAN, pass `--host`; the CLI will then listen on `0.0.0.0` and print the available LAN addresses.

DLNA media servers are not scanned during startup by default. Pass `--dlna-scan` to discover them before opening the Web UI; manual scanning remains available in the Web UI.

Build the standalone executable, including Web assets, WASM, and face-tracking models:

```sh
bun run build:cli
./cli/dist/fsvr ~/Movies
```

The Web UI embedded in `fsvr` is built without the PWA manifest or service worker. The standalone official Web build keeps PWA support.

### Docker

Run the media server from the published GHCR image, mounting the media directory read-only:

```sh
docker run --rm -p 4090:4090 -v "$HOME/Movies:/media:ro" ghcr.io/foursmith/vr:latest
```

The generated access password is printed in the container logs. Add `--disable-password` after the image name to disable authentication, or `--password <password>` to set a stable password.

For Docker Compose, copy the environment example and set `FSVR_MEDIA_DIR` to a local directory or mounted disk:

```sh
cp .env.example .env
docker compose up -d
docker compose logs fsvr
```

Use `docker compose up -d --build` to build the image from the current source. On macOS, an external disk path typically looks like `/Volumes/Media/Movies`; on Linux, it might be `/mnt/media`.

Release tags matching `v*` publish multi-architecture Docker images to `ghcr.io/foursmith/vr` and create a GitHub Release with an automatically generated changelog.

## License

Foursmith VR is licensed under the [Mozilla Public License 2.0](LICENSE).
