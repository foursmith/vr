import type { JSX } from "@solidjs/web"
import { LiquidGlass } from "./LiquidGlass"
import { ProgressTrack } from "./ProgressTrack"

export function GlassRange(props: {
  min: number
  max: number
  step: number
  value: number
  progress: number
  label: string
  valueLabel?: string
  class?: JSX.ClassValue
  inputClass?: JSX.ClassValue
  disabled?: boolean
  onInput: (value: number) => void
  onChange?: (value: number) => void
  onPointerDown?: () => void
  onPointerUp?: (pointerType: string) => void
  onPointerCancel?: () => void
}) {
  return (
    <ProgressTrack progress={props.progress} class={props.class}>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        aria-label={props.label}
        aria-valuetext={props.valueLabel}
        class={["glass-range-input absolute inset-0 z-10 h-full w-full appearance-none bg-transparent", props.inputClass ?? "cursor-pointer"]}
        onPointerDown={() => props.onPointerDown?.()}
        onPointerUp={event => props.onPointerUp?.(event.pointerType)}
        onPointerCancel={() => props.onPointerCancel?.()}
        onInput={event => props.onInput(Number(event.currentTarget.value))}
        onChange={event => props.onChange?.(Number(event.currentTarget.value))}
      />
      <LiquidGlass
        class="liquid-glass-range-thumb pointer-events-none !absolute z-20 h-4 w-4 rounded-full"
        style={{
          left: "calc(var(--progress) - 0.5rem)",
          top: "calc(50% - 0.5rem)",
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
    </ProgressTrack>
  )
}
