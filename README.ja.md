<img src="public/icon.svg" alt="Foursmith VR アプリアイコン" width="160" height="160" align="left" hspace="20">

<h3>Foursmith VR</h3>

<em>ライブ配信を見る感覚で VR を楽しもう。</em>

ヘッドセットなしで、VR 酔いが心配な方も快適に VR 動画を楽しめます。動画を開いたら、くつろいでご覧ください。

<a href="https://vr.foursmith.com/"><strong>Foursmith VR を開く →</strong></a>

<br clear="all">

<div align="center">
  <p><sub><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · 日本語</sub></p>
</div>

## デモ動画（職場でも安心して見られます）

[![Foursmith VR のデモ動画を見る](doc/youtube-thumbnail.png)](https://www.youtube.com/watch?v=TxfZAjrw_Q8)

## 機能

| 視聴体験 | メディアとツール |
| --- | --- |
| **ヘッドセット不要**<br>見やすい 2D ビューに、自動フレーミングとポートレートレイアウト。 | **幅広い形式**<br>180°、360°、サイドバイサイド、トップボトム、魚眼、平面動画に対応。 |
| **ピクチャーインピクチャー（Chromium）**<br>縦長ビューと字幕を常に手前に表示。ドラッグで視点を動かし、クリックで再生／一時停止。 | **動画ライブラリ**<br>ローカルのファイルとフォルダー、付属メディアサーバー、DLNA 検出、字幕の自動関連付け。 |
| **デスクトップ PWA**<br>OS から MP4、M4V、MKV を開き、アプリ内で更新。 | **A–B 書き出し**<br>現在のビューを WebM、MP4、Motion Photo として保存。対応ブラウザでは字幕も含みます。 |

マウス、キーボード、オンスクリーンコントロールに対応。Foursmith VR は無料のオープンソースソフトウェアです。

## 使い方

> [!IMPORTANT]
> ほとんどの 8K VR 動画は、Safari や Firefox では正常に再生できない、または再生が滑らかでない場合があります。iOS 上のブラウザはすべて、Safari と同じ WebKit エンジンで動作します。

快適に視聴するには、デスクトップ版の Chrome、Edge、またはその他の Chromium 系ブラウザをご利用ください。

### キーボードショートカット

| ショートカット | 操作 |
| --- | --- |
| Space | 再生／一時停止 |
| Left | 10 秒戻る |
| Right | 10 秒進む |
| Shift + Left | 60 秒戻る |
| Shift + Right | 60 秒進む |
| Up / Down | 音量を調整 |
| M | ミュートをオン／オフ |
| F | 全画面表示をオン／オフ |
| R | 視点をリセット |
| [ / - | ズームアウト |
| ] / = | ズームイン |
| 1-7 | 投影方式を選択 |
| , / . | 前／次の画質プリセットに切り替え |

## デプロイ

[![Cloudflare にデプロイ](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/foursmith/vr)
[![Vercel でデプロイ](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ffoursmith%2Fvr&root-directory=.)

## ローカルメディアサーバー

ローカルメディアサーバーの起動には Docker の利用をおすすめします。Web UI 一式を配信し、ローカルのメディアディレクトリをブラウザから利用できるようにするほか、DLNA 機器の検出にも対応します。

### Docker Compose

サンプルの環境変数ファイルをコピーし、`FSVR_MEDIA_DIR` にメディアを保存しているディレクトリまたはマウント済みディスクを指定してから、サービスを起動します。

```sh
cp .env.example .env
docker compose up -d
docker compose logs fsvr
```

ブラウザで `http://localhost:4090` にアクセスし、`docker compose logs fsvr` に出力されたパスワードでログインします。メディアディレクトリは読み取り専用でマウントされます。macOS の外付けディスクなら通常 `/Volumes/Media/Movies`、Linux なら `/mnt/media` といったパスです。

公開済みイメージを使わず、現在のソースコードからビルドする場合は、`docker compose up -d --build` を実行してください。

### Docker run

公開済みイメージを使い、`~/Movies` をメディアディレクトリとして起動するには、次のコマンドを実行します。

```sh
docker run --rm -p 4090:4090 -v "$HOME/Movies:/media:ro" ghcr.io/foursmith/vr:latest
```

自動生成されたアクセスパスワードは、コンテナのログに出力されます。認証を無効にするにはイメージ名の後に `--disable-password` を追加し、任意の固定パスワードを設定するには `--password <password>` を指定します。

`v*` に一致するリリースタグを作成すると、`ghcr.io/foursmith/vr` にマルチアーキテクチャの Docker イメージが公開され、自動生成された変更履歴を含む GitHub Release も作成されます。

## 開発

### 技術スタック

| 分野 | 技術 |
| --- | --- |
| Web UI | SolidJS 2 beta、TypeScript |
| ビルド／PWA | Vite、Vite PWA |
| VR レンダリング | Three.js |
| 顔トラッキング | MediaPipe Tasks Vision |
| スタイリング／アイコン | UnoCSS（`presetWind3()`）、Iconify |
| ローカルメディアサーバー | Bun、Citty |
| テスト | Vitest、Playwright |

### 開発環境のセットアップ

[Bun](https://bun.sh/) が必要です。依存関係をインストールして、Web アプリを起動します。

```sh
bun install
bun run dev
```

Web アプリとローカルメディアサーバーを同時に開発する場合は、メディアディレクトリのパスを渡します。

```sh
bun run dev:cli -- ~/Movies
```

どちらのコマンドもホットリロードに対応しています。メディアサーバーの開発用コマンドでは、認証を無効にした状態で `http://127.0.0.1:4090` にサーバーが立ち上がります。

各種チェックと本番用ビルドは、次のコマンドで実行できます。

```sh
bun run typecheck
bun run test
bun run build
bun run typecheck:cli
bun run test:cli
bun run build:cli
```

## コントリビューション

バグ報告、機能リクエスト、プルリクエストを歓迎します。バグの修正や大きな変更に着手する前に、[GitHub Issues](https://github.com/foursmith/vr/issues) でご相談ください。

1. リポジトリをフォークし、変更内容を明確に絞ったブランチを作成します。
2. 変更を実装し、必要に応じてテストを追加または更新します。
3. `bun run lint`、`bun run typecheck`、`bun run test` を実行します。CLI に変更を加えた場合は、`bun run typecheck:cli` と `bun run test:cli` も実行してください。
4. [Conventional Commits](https://www.conventionalcommits.org/) に準拠したコミットメッセージを使用します。例：`fix(player): correct projection reset`
5. 変更内容と検証方法を記載して、プルリクエストを作成します。

Web UI を変更する際は、プロジェクトの [SolidJS 2 移行ガイド](doc/MIGRATION.md) と既存の UnoCSS Wind3 規約に従ってください。顔の検出・トラッキング・中央配置に関するアルゴリズムを変更した場合は、[人物の中央配置に関するメンテナンス資料](doc/PORTRAIT_CENTERING.md) も同じ変更の中で更新してください。

## ライセンス

Foursmith VR は [Mozilla Public License 2.0](LICENSE) に基づいて提供されています。

コードは GPT-5.6 Sol。
センスは [ourongxing](https://github.com/ourongxing)。
