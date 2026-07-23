<div align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="doc/banner.jpg">
    <img src="doc/banner.webp" alt="Foursmith VR" width="960">
  </picture>
  <h1>Foursmith VR</h1>
  <p><sub>English · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a></sub></p>
  <p><strong><em>Watch VR like TikTok</em></strong></p>
  <p><em>A comfortable way to enjoy VR video—no headset required, even if you're prone to motion sickness. Just sit back and watch.</em></p>
  <p><a href="https://vr.foursmith.com/"><strong>Open Foursmith VR →</strong></a></p>
</div>

## Demo Video (Safe for Work)

[▶ Watch the demo video](https://cdn.jsdelivr.net/gh/foursmith/vr@main/doc/demo.mp4)

## Features

| Viewing | Media & tools |
| --- | --- |
| **Headset-free VR**<br>Comfortable 2D viewing with automatic face framing and portrait layouts. | **Broad format support**<br>180°, 360°, side-by-side, top-and-bottom, fisheye, and flat video. |
| **Picture-in-picture (Chromium)**<br>Keep the portrait view and subtitles on top; drag to look and click to play or pause. | **Your whole library**<br>Local files and folders, the bundled media server, DLNA discovery, and automatic subtitle matching. |
| **Installable PWA**<br>Open MP4, M4V, and MKV files from your OS and apply updates in the app. | **A–B export**<br>Save the current view as WebM, MP4, or Motion Photo, with subtitles where supported. |

Mouse, keyboard, and on-screen controls are all included. Foursmith VR is free and open source.

## Usage

> [!IMPORTANT]
> Safari and Firefox may struggle to play most 8K VR videos reliably or smoothly. On iOS, all browsers use Safari's underlying engine.

For the best experience, use desktop Chrome, Edge, or another Chromium-based browser.

### Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| Space | Play or pause |
| Left | Seek backward 10 seconds |
| Right | Seek forward 10 seconds |
| Shift + Left | Seek backward 60 seconds |
| Shift + Right | Seek forward 60 seconds |
| Up / Down | Adjust volume |
| M | Mute or unmute |
| F | Toggle fullscreen |
| R | Reset view |
| [ / - | Zoom out |
| ] / = | Zoom in |
| 1-7 | Select projection |
| , / . | Previous or next quality preset |

## Deployment

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/foursmith/vr)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ffoursmith%2Fvr&root-directory=.)

## Local media server

Docker is the recommended way to run the local media server. The container serves the web app and files from your local media directories, and supports DLNA discovery.

### Docker Compose

Copy the example environment file, set `FSVR_MEDIA_DIR` to the directory or mounted drive that contains your media, then start the service:

```sh
cp .env.example .env
docker compose up -d
docker compose logs fsvr
```

Open `http://localhost:4090` and enter the password shown in the output from `docker compose logs fsvr`. The media directory is mounted read-only. On macOS, a path on an external drive typically looks like `/Volumes/Media/Movies`; on Linux, it might be `/mnt/media`.

Use `docker compose up -d --build` to build the image from your current checkout instead of using the published image.

### Docker run

To run the published image with `~/Movies` as the media directory:

```sh
docker run --rm -p 4090:4090 -v "$HOME/Movies:/media:ro" ghcr.io/foursmith/vr:latest
```

The generated access password appears in the container logs. To disable authentication, add `--disable-password` after the image name; to use a fixed password, add `--password <password>`.

Each release tag matching `v*` publishes multi-architecture Docker images to `ghcr.io/foursmith/vr` and creates a GitHub release with an automatically generated changelog.

## Development

### Technology stack

| Area | Technology |
| --- | --- |
| Web UI | SolidJS 2 beta, TypeScript |
| Build and PWA | Vite, Vite PWA |
| VR rendering | Three.js |
| Face tracking | MediaPipe Tasks Vision |
| Styling and icons | UnoCSS with `presetWind3()`, Iconify |
| Local media server | Bun, Citty |
| Testing | Vitest, Playwright |

### Getting started

Development requires [Bun](https://bun.sh/). Install the dependencies and start the web app:

```sh
bun install
bun run dev
```

To run the web app and local media server together, provide the path to a media directory:

```sh
bun run dev:cli -- ~/Movies
```

Both commands support hot reload. In development, the media server runs at `http://127.0.0.1:4090` with authentication disabled.

Run the checks and production builds:

```sh
bun run typecheck
bun run test
bun run build
bun run typecheck:cli
bun run test:cli
bun run build:cli
```

## Contributing

Bug reports, feature requests, and pull requests are welcome. Please open a [GitHub Issue](https://github.com/foursmith/vr/issues) to discuss a bug or substantial change before you start work.

1. Fork the repository, then create a focused branch for your changes.
2. Make your changes. Add or update tests where appropriate.
3. Run `bun run lint`, `bun run typecheck`, and `bun run test`. For CLI changes, also run `bun run typecheck:cli` and `bun run test:cli`.
4. Write a [Conventional Commit](https://www.conventionalcommits.org/) message, such as `fix(player): correct projection reset`.
5. Open a pull request that explains what changed and how you tested it.

For web UI changes, follow the project's [SolidJS 2 migration guide](doc/MIGRATION.md) and its existing UnoCSS Wind3 conventions. If you change any face-detection, tracking, or centering algorithms, update the [portrait centering reference](doc/PORTRAIT_CENTERING.md) in the same pull request.

## License

Foursmith VR is licensed under the [Mozilla Public License 2.0](LICENSE).

Code by GPT-5.6 Sol.
Taste by [ourongxing](https://github.com/ourongxing).
