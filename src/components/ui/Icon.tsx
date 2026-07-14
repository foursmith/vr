import { Match, Switch } from "solid-js"

const ICONS = {
  "bug": "i-ph-bug",
  "caret-down": "i-ph-caret-down",
  "check": "i-ph-check",
  "corners-in": "i-ph-corners-in",
  "corners-out": "i-ph-corners-out",
  "cube-focus": "i-ph-cube-focus",
  "columns": "i-ph-columns",
  "dlna-scan": "i-ph-broadcast-duotone",
  "download": "i-ph-download-simple",
  "fast-forward": "i-ph-fast-forward",
  "file-video": "i-ph-youtube-logo-duotone",
  "folder": "i-ph-folder",
  "folder-fill": "i-ph-folder-fill",
  "folder-open": "i-ph-folder-open",
  "folder-open-fill": "i-ph-folder-open-fill",
  "gauge": "i-ph-gauge",
  "github": "i-ph-github-logo",
  "keyboard": "i-ph-keyboard",
  "lock": "i-ph-lock-key",
  "unlock": "i-ph-lock-key-open",
  "pause": "i-ph-pause",
  "play": "i-ph-play",
  "playlist": "i-ph-playlist",
  "playlist-repeat": "i-ph-arrows-clockwise",
  "plus": "i-ph-plus",
  "rewind": "i-ph-rewind",
  "scale": "i-ph-magnifying-glass-plus",
  "settings": "i-ph-gear-six",
  "sliders": "i-ph-sliders-horizontal",
  "subtitles": "i-ph-subtitles",
  "rotate-ccw": "i-ph-arrow-counter-clockwise",
  "repeat": "i-ph-repeat",
  "repeat-once": "i-ph-repeat-once",
  "scan-face": "i-ph-scan-smiley",
  "screen-share": "i-ph-screencast",
  "server": "i-ph-hard-drives",
  "source-dlna": "i-ph-broadcast-duotone",
  "source-local": "i-ph-floppy-disk-duotone",
  "source-url": "i-ph-link-simple-horizontal-duotone",
  "upload": "i-ph-upload",
  "video": "i-ph-video",
  "trash": "i-ph-trash",
  "volume-1": "i-ph-speaker-simple-low",
  "volume-2": "i-ph-speaker-simple-high",
  "volume-x": "i-ph-speaker-simple-x",
  "x": "i-ph-x",
} as const

type CustomIconName = "folder-repeat" | "play-once"

export type IconName = keyof typeof ICONS | CustomIconName

export function Icon(props: { name: IconName, class?: string }) {
  const iconClass = () => props.class ?? "h-4.5 w-4.5"
  const iconUtility = () => ICONS[props.name as keyof typeof ICONS]

  return (
    <Switch fallback={<span aria-hidden="true" class={[iconUtility(), iconClass()]}></span>}>
      <Match when={props.name === "play-once"}>
        <svg
          aria-hidden="true"
          data-icon="play-once"
          viewBox="0 0 24 24"
          fill="none"
          class={iconClass()}
        >
          <path d="M5.25 5.2v13.6L15.8 12 5.25 5.2Z" fill="currentColor" />
          <path d="M19 5.25v13.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </Match>
      <Match when={props.name === "folder-repeat"}>
        <svg
          aria-hidden="true"
          data-icon="folder-repeat"
          viewBox="0 0 24 24"
          fill="none"
          class={iconClass()}
        >
          <path
            d="M2 6.5a2 2 0 0 1 2-2h4.25l2.2 2.35H20a2 2 0 0 1 2 2v10.1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6.5Z"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
          />
          <path d="M6.5 12.25h10.75m0 0-2-2m2 2-2 2" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M17.5 16.75H6.75m0 0 2 2m-2-2 2-2" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </Match>
    </Switch>
  )
}
