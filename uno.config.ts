import { defineConfig, presetIcons, presetWind3 } from "unocss"

export default defineConfig({
  content: {
    pipeline: {
      include: [/\.(tsx?|html)($|\?)/],
    },
    filesystem: ["index.html", "src/**/*.{ts,tsx,html}"],
  },
  presets: [
    presetWind3(),
    presetIcons({
      scale: 1.05,
      warn: true,
    }),
  ],
  theme: {
    colors: {
      accent: "#8ae7e4",
    },
    fontFamily: {
      sans: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
      mono: "\"SFMono-Regular\", \"Cascadia Code\", Consolas, monospace",
      serif: "\"Iowan Old Style\", \"Palatino Linotype\", Palatino, Georgia, serif",
    },
  },
})
