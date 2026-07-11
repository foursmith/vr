const ICONS = {
  "bug": "i-ph-bug",
  "corners-in": "i-ph-corners-in",
  "corners-out": "i-ph-corners-out",
  "cube-focus": "i-ph-cube-focus",
  "columns": "i-ph-columns",
  "fast-forward": "i-ph-fast-forward",
  "file-video": "i-ph-file-video",
  "folder": "i-ph-folder",
  "folder-open": "i-ph-folder-open",
  "gauge": "i-ph-gauge",
  "pause": "i-ph-pause",
  "play": "i-ph-play",
  "playlist": "i-ph-playlist",
  "plus": "i-ph-plus",
  "rewind": "i-ph-rewind",
  "scale": "i-ph-magnifying-glass-plus",
  "settings": "i-ph-gear-six",
  "subtitles": "i-ph-subtitles",
  "rotate-ccw": "i-ph-arrow-counter-clockwise",
  "scan-face": "i-ph-scan-smiley",
  "screen-share": "i-ph-screencast",
  "upload": "i-ph-upload",
  "video": "i-ph-video",
  "trash": "i-ph-trash",
  "volume-1": "i-ph-speaker-simple-low",
  "volume-2": "i-ph-speaker-simple-high",
  "volume-x": "i-ph-speaker-simple-x",
  "x": "i-ph-x",
} as const

export type IconName = keyof typeof ICONS

export function Icon(props: { name: IconName, class?: string }) {
  return <span aria-hidden="true" class={[ICONS[props.name], props.class ?? "h-4.5 w-4.5"]}></span>
}
