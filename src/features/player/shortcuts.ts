import { PROJECTION_OPTIONS } from "@foursmith/player-core/config"

export const SHORTCUT_DEFINITIONS = [
  { label: "Play / pause", key: "Space" },
  { label: "Seek backward 10 seconds", key: "←" },
  { label: "Seek forward 10 seconds", key: "→" },
  { label: "Seek backward 60 seconds", key: "Shift + ←" },
  { label: "Seek forward 60 seconds", key: "Shift + →" },
  { label: "Volume up", key: "↑" },
  { label: "Volume down", key: "↓" },
  { label: "Mute / unmute", key: "M" },
  { label: "Enter / exit fullscreen", key: "F" },
  { label: "Reset view", key: "R" },
  { label: "Zoom out", key: "[ / −" },
  { label: "Zoom in", key: "] / +" },
  { label: "Previous quality", key: "," },
  { label: "Next quality", key: "." },
  ...PROJECTION_OPTIONS.map((projection, index) => ({
    label: `Projection: ${projection.label}`,
    key: String(index + 1),
  })),
] as const
