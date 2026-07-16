import type { JSX } from "@solidjs/web"

export function FsvrLogo(props: { class?: JSX.ClassValue, title?: string }) {
  return (
    <svg
      viewBox="0 0 320 320"
      role={props.title ? "img" : undefined}
      aria-label={props.title}
      aria-hidden={props.title ? undefined : "true"}
      class={props.class}
    >
      <defs>
        <linearGradient id="fsvr-logo-lens" x1="70" y1="54" x2="250" y2="270" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#f5fffc" />
          <stop offset=".42" stop-color="#b8f3ec" />
          <stop offset="1" stop-color="#62cfd8" />
        </linearGradient>
        <mask id="fsvr-logo-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="320">
          <path
            fill="white"
            transform="translate(125.005 124.829375) scale(.625)"
            d="M258.626-146.231c-48.304-48.118-117.759-53.496-202.634-53.496-84.982 0-154.542 5.44-202.826 53.688-48.277 48.228-53.174 117.676-53.174 202.561 0 84.899 4.897 154.368 53.194 202.613 48.281 48.255 117.833 53.139 202.806 53.139 84.974 0 154.514-4.884 202.795-53.139 48.294-48.254 53.205-117.714 53.205-202.613 0-84.994-4.964-154.517-53.366-202.753Z"
          />
          <path fill="black" d="M60 160Q136 60 235 92Q205 160 235 228Q136 260 60 160Z" />
          <circle cx="160" cy="160" r="42" fill="white" />
          <circle cx="160" cy="160" r="17" fill="black" />
        </mask>
      </defs>
      <rect width="320" height="320" fill="url(#fsvr-logo-lens)" mask="url(#fsvr-logo-mask)" />
    </svg>
  )
}
