import { PROJECTION_OPTIONS } from "../vr/config"

export const SHORTCUT_DEFINITIONS = [
  { labelKey: "shortcuts.playPause", key: "Space" },
  { labelKey: "shortcuts.seekBack10", key: "←" },
  { labelKey: "shortcuts.seekForward10", key: "→" },
  { labelKey: "shortcuts.seekBack60", key: "Shift + ←" },
  { labelKey: "shortcuts.seekForward60", key: "Shift + →" },
  { labelKey: "shortcuts.volumeUp", key: "↑" },
  { labelKey: "shortcuts.volumeDown", key: "↓" },
  { labelKey: "shortcuts.muteUnmute", key: "M" },
  { labelKey: "shortcuts.fullscreen", key: "F" },
  { labelKey: "shortcuts.resetView", key: "R" },
  { labelKey: "shortcuts.zoomOut", key: "[ / −" },
  { labelKey: "shortcuts.zoomIn", key: "] / +" },
  { labelKey: "shortcuts.previousQuality", key: "," },
  { labelKey: "shortcuts.nextQuality", key: "." },
  ...PROJECTION_OPTIONS.map((projection, index) => ({
    projection: projection.component,
    key: String(index + 1),
  })),
] as const
