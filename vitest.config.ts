import solid from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/lib/*.ts",
        "src/features/{fsvr,playlist,subtitles}/**/*.ts",
        "src/features/player/{controls,display}.ts",
        "src/features/player/controller/**/*.ts",
        "src/features/vr/detection/{face-detector-service,face-tracker-client,mediapipe-client}.ts",
        "src/features/vr/rendering/{projection,render-cadence-policy,vr-render-runtime}.ts",
        "src/features/vr/tracking/{face-center-movement,face-detection-state,face-sampling,face-target-tracking,inference-schedule-policy}.ts",
      ],
    },
  },
})
