import type { JSX } from "@solidjs/web"
import type { Element } from "solid-js"

export function ProgressTrack(props: {
  progress: number
  class?: JSX.ClassValue
  role?: "progressbar"
  label?: string
  children?: Element
}) {
  const progress = () => Math.min(100, Math.max(0, props.progress))

  return (
    <div
      class={["relative h-[1.35rem] min-w-0 w-full [--fill:rgba(255,255,255,0.82)] [--track:rgba(255,255,255,0.18)]", props.class]}
      style={`--progress:${progress()}%`}
      role={props.role}
      aria-label={props.label}
      aria-valuemin={props.role ? "0" : undefined}
      aria-valuemax={props.role ? "100" : undefined}
      aria-valuenow={props.role ? progress() : undefined}
    >
      <span
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 top-1/2 h-[0.28rem] -translate-y-1/2 overflow-hidden rounded-full bg-[var(--track)]"
      >
        <span class="block h-full rounded-full bg-[var(--fill)]" style={{ width: "var(--progress)" }}></span>
      </span>
      {props.children}
    </div>
  )
}
