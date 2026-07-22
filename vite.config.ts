import { execFileSync } from "node:child_process"
import UnoCSS from "unocss/vite"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
import solid from "vite-plugin-solid"

function readGit(args: string[]) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

function resolveBuildVersion() {
  const ciTag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined
  if (ciTag?.startsWith("v")) return ciTag

  const exactTag = readGit(["tag", "--points-at", "HEAD", "--list", "v*", "--sort=-version:refname"])
    .split("\n")
    .find(Boolean)
  if (exactTag) return exactTag

  return (process.env.GITHUB_SHA || readGit(["rev-parse", "HEAD"]) || "unknown").slice(0, 7)
}

export default defineConfig(({ command, mode }) => ({
  define: {
    __FSVR_VERSION__: JSON.stringify(resolveBuildVersion()),
  },
  server: {
    port: mode === "fsvr-dev" ? 4090 : 2333,
    strictPort: true,
    proxy: mode === "fsvr-dev"
      ? {
          "/api": {
            target: process.env.FSVR_API_ORIGIN,
            changeOrigin: true,
          },
        }
      : undefined,
  },
  build: {
    chunkSizeWarningLimit: 550,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (id.includes("/three/")) return "vendor-three"
        },
      },
    },
  },
  plugins: [
    solid(),
    UnoCSS(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "apple-touch-icon.png", "pwa-192x192.png", "pwa-512x512.png"],
      workbox: {
        globIgnores: [
          "assets/vision_bundle-*.js",
          "assets/worker-*.js",
          "mediapipe/tasks-vision/wasm/**",
        ],
        globPatterns: ["**/*.{js,wasm,css,html,ico,png,svg,webmanifest}"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(?:vision_bundle|worker)-.*\.js$/,
            handler: "CacheFirst",
            options: {
              cacheName: "face-tracking-code",
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 2,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: /\/mediapipe\/tasks-vision\/wasm\/.*\.(?:js|wasm)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "face-tracking-runtime",
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 2,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: /\/models\/.*\.(?:tflite|task)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "face-tracking-models",
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 3,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
      manifest: {
        id: "/",
        name: "Foursmith VR",
        short_name: "Foursmith VR",
        description: "Watch VR like TikTok",
        start_url: "/",
        scope: "/",
        theme_color: "#62cfd8",
        background_color: "#62cfd8",
        display: "standalone",
        categories: ["video", "photo", "entertainment", "utilities"],
        launch_handler: {
          client_mode: "focus-existing",
        },
        file_handlers: [
          {
            action: "/",
            accept: {
              "video/mp4": [".mp4", ".m4v"],
              "video/matroska": [".mkv"],
            },
          },
        ],
        icons: [
          {
            src: "/icon.svg",
            type: "image/svg+xml",
            sizes: "any",
            purpose: "any",
          },
          {
            src: "/pwa-192x192.png",
            type: "image/png",
            sizes: "192x192",
          },
          {
            src: "/pwa-512x512.png",
            type: "image/png",
            sizes: "512x512",
            purpose: "any maskable",
          },
        ],
      },
      disable: command === "serve" || mode.startsWith("fsvr"),
    }),
  ],
}))
