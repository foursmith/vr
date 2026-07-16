import solid from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/lib/*.ts",
        "src/features/player/{controls,display}.ts",
        "src/features/player/controller.ts",
        "src/features/face-tracking/client.ts",
        "src/features/playlist/model.ts",
        "src/features/vr/{face-auto-center,face-detection-state,face-sampling,projection}.ts",
      ],
    },
  },
})
