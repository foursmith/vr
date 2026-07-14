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
    breakpoints: {
      "xs": "480px",
      "sm": "640px",
      "md": "768px",
      "lg": "1024px",
      "xl": "1280px",
      "2xl": "1536px",
    },
    colors: {
      accent: "#62cfd8",
    },
    fontFamily: {
      sans: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
      mono: "\"SFMono-Regular\", \"Cascadia Code\", Consolas, monospace",
      serif: "\"Iowan Old Style\", \"Palatino Linotype\", Palatino, Georgia, serif",
    },
  },
})
