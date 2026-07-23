<img src="public/icon.svg" alt="Foursmith VR 应用图标" width="160" height="160" align="left" hspace="20">

<h3>Foursmith VR</h3>

<em>像看直播一样观看 VR。</em>

也许是最轻松的 VR 观看方式——不用戴头显，也不怕晕。打开视频，坐下来直接看就好。

<a href="https://vr.foursmith.com/"><strong>打开 Foursmith VR →</strong></a>

<br clear="all">

<div align="center">
  <p><sub><a href="README.md">English</a> · 简体中文 · <a href="README.ja.md">日本語</a></sub></p>
</div>

## 演示视频（无敏感内容）

[![观看 Foursmith VR 演示视频](doc/youtube-thumbnail.png)](https://www.youtube.com/watch?v=TxfZAjrw_Q8)

## 功能

| 观看体验 | 片源与工具 |
| --- | --- |
| **无需头显也能看 VR**<br>将 VR 视频转成舒适的 2D 画面，自动跟随人物并保持竖屏构图。 | **常见格式直接播放**<br>支持 180°、360°、左右、上下、鱼眼和普通平面视频。 |
| **画中画（仅 Chromium）**<br>让竖屏画面和字幕悬浮在最前面；拖动调整视角，单击播放或暂停。 | **本地片库随手打开**<br>打开本地文件和文件夹，或通过内置媒体服务器、DLNA 浏览片库；字幕自动匹配。 |
| **可安装为桌面应用（PWA）**<br>从系统直接打开 MP4、M4V 和 MKV；有新版本时在应用内更新。 | **截取并导出 A–B 片段**<br>导出当前视角的 WebM、MP4 或动态照片；浏览器支持时可保留字幕。 |

支持鼠标、键盘快捷键和屏幕控件；Foursmith VR 免费开源。

## 使用说明

> [!IMPORTANT]
> 大多数 8K VR 视频在 Safari 或 Firefox 中可能无法正常播放，或播放不够流畅。iOS 上的所有浏览器底层都采用与 Safari 相同的 WebKit 引擎。

建议使用桌面版 Chrome、Edge 或其他 Chromium 浏览器。

### 键盘快捷键

| 快捷键 | 操作 |
| --- | --- |
| 空格 | 播放或暂停 |
| 左方向键 | 快退 10 秒 |
| 右方向键 | 快进 10 秒 |
| Shift + 左方向键 | 快退 60 秒 |
| Shift + 右方向键 | 快进 60 秒 |
| 上 / 下方向键 | 调整音量 |
| M | 静音或取消静音 |
| F | 切换全屏 |
| R | 重置视角 |
| [ / - | 缩小 |
| ] / = | 放大 |
| 1–7 | 选择投影模式 |
| , / . | 切换到上一档或下一档画质预设 |

## 部署

[![部署到 Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/foursmith/vr)
[![使用 Vercel 部署](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ffoursmith%2Fvr&root-directory=.)

## 本地媒体服务器

推荐通过 Docker 运行本地媒体服务器。它既提供完整的 Web 界面，也能读取本地媒体目录，并发现 DLNA 设备。

### Docker Compose

复制示例环境变量文件，将 `FSVR_MEDIA_DIR` 设为媒体文件所在的目录或磁盘挂载路径，然后启动服务：

```sh
cp .env.example .env
docker compose up -d
docker compose logs fsvr
```

打开 `http://localhost:4090`，使用 `docker compose logs fsvr` 输出的密码登录。媒体目录会以只读方式挂载。在 macOS 上，外置磁盘的路径通常类似 `/Volumes/Media/Movies`；在 Linux 上则可能是 `/mnt/media`。

如需基于当前源码自行构建镜像，请运行 `docker compose up -d --build`，而不是直接使用已发布的镜像。

### Docker run

将 `~/Movies` 挂载为媒体目录，直接运行已发布的镜像：

```sh
docker run --rm -p 4090:4090 -v "$HOME/Movies:/media:ro" ghcr.io/foursmith/vr:latest
```

自动生成的访问密码会输出到容器日志中。在镜像名称后传入 `--disable-password` 可关闭身份验证，传入 `--password <password>` 则可设置固定密码。

以 `v*` 格式命名的版本标签会触发发布流程：向 `ghcr.io/foursmith/vr` 推送多架构 Docker 镜像，并创建附带自动生成更新日志的 GitHub Release。

## 开发

### 技术栈

| 领域 | 技术 |
| --- | --- |
| Web 界面 | SolidJS 2 beta、TypeScript |
| 构建与 PWA | Vite、Vite PWA |
| VR 渲染 | Three.js |
| 人脸跟踪 | MediaPipe Tasks Vision |
| 样式与图标 | UnoCSS（`presetWind3()`）、Iconify |
| 本地媒体服务器 | Bun、Citty |
| 测试 | Vitest、Playwright |

### 开始开发

请先安装 [Bun](https://bun.sh/)，然后安装依赖并启动 Web 应用：

```sh
bun install
bun run dev
```

如需同时启动 Web 应用和本地媒体服务器进行开发，请传入媒体目录：

```sh
bun run dev:cli -- ~/Movies
```

以上两个开发命令均支持热更新。媒体服务器的开发模式会在 `http://127.0.0.1:4090` 启动，且不启用身份验证。

运行检查和生产构建：

```sh
bun run typecheck
bun run test
bun run build
bun run typecheck:cli
bun run test:cli
bun run build:cli
```

## 参与贡献

欢迎反馈 Bug、提出功能建议或提交 Pull Request。在着手修复 Bug 或进行较大改动之前，请先通过 [GitHub Issues](https://github.com/foursmith/vr/issues) 讨论。

1. Fork 本仓库，并创建一个目标明确的分支。
2. 完成改动，并视情况添加或更新测试。
3. 运行 `bun run lint`、`bun run typecheck` 和 `bun run test`。如改动涉及 CLI，还需运行 `bun run typecheck:cli` 和 `bun run test:cli`。
4. 提交信息请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范，例如 `fix(player): correct projection reset`。
5. 提交 Pull Request，说明改动内容和验证方式。

修改 Web 界面时，请遵循项目的 [SolidJS 2 迁移指南](doc/MIGRATION.md) 和现有 UnoCSS Wind3 规范。如改动涉及人脸检测、跟踪或居中算法，还必须同步更新 [人像居中维护文档](doc/PORTRAIT_CENTERING.md)。

## 许可证

Foursmith VR 采用 [Mozilla Public License 2.0](LICENSE) 许可证发布。

代码出自 GPT-5.6 Sol。
品味来自 [ourongxing](https://github.com/ourongxing)。
