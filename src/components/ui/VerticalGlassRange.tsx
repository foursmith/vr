import { LiquidGlass } from "./LiquidGlass"

export function VerticalGlassRange(props: {
  min: number
  max: number
  step: number
  value: number
  progress: number
  label: string
  title?: string
  onInput: (value: number) => void
}) {
  const progress = () => Math.min(100, Math.max(0, props.progress))

  return (
    <div
      class="relative h-24 w-6 [--fill:rgba(255,255,255,0.82)] [--track:rgba(255,255,255,0.18)]"
      style={`--progress:${progress()}%`}
    >
      <span
        aria-hidden="true"
        class="pointer-events-none absolute inset-y-0 left-1/2 w-[0.28rem] -translate-x-1/2 overflow-hidden rounded-full"
        style={{ background: "var(--track)" }}
      >
        <span
          class="absolute inset-x-0 bottom-0 rounded-full"
          style={{ height: "var(--progress)", background: "var(--fill)" }}
        >
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-label={props.label}
        title={props.title}
        class="vertical-range absolute inset-0 z-10 h-24 w-6 cursor-default appearance-none bg-transparent"
        onInput={event => props.onInput(Number(event.currentTarget.value))}
      />
      <LiquidGlass
        class="liquid-glass-range-thumb pointer-events-none !absolute z-20 h-4 w-4 rounded-full"
        style={{
          left: "calc(50% - 0.5rem)",
          top: "calc(100% - var(--progress) - 0.5rem)",
        }}
        cornerRadius={999}
        elasticity={0}
        active
        castShadow={false}
      >
        <span
          aria-hidden="true"
          class="block h-full w-full rounded-full border border-white/34 bg-[linear-gradient(145deg,rgba(255,255,255,0.26),rgba(255,255,255,0.12))] shadow-[inset_0_1px_1px_rgba(255,255,255,0.68),0_2px_8px_rgba(0,0,0,0.24)]"
        >
        </span>
      </LiquidGlass>
    </div>
  )
}
