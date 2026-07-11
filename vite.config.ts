import UnoCSS from "unocss/vite"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
import solid from "vite-plugin-solid"

export default defineConfig(({ command }) => ({
  server: {
    port: 2333,
    strictPort: true,
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
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "pwa-192x192.png", "pwa-512x512.png"],
      workbox: {
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
      manifest: {
        id: "/",
        name: "Foursmith VR",
        short_name: "Foursmith VR",
        description: "Watch VR like TikTok LIVE",
        start_url: "/",
        scope: "/",
        theme_color: "#061a28",
        background_color: "#061a28",
        display: "standalone",
        categories: ["video", "photo", "entertainment", "utilities"],
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      disable: command === "serve",
    }),
  ],
}))
