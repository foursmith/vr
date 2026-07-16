import type { JSX } from "@solidjs/web"
import type { IconName } from "./Icon"
import { Show } from "solid-js"
import { Icon } from "./Icon"
import { LiquidGlass } from "./LiquidGlass"

const iconButtonClass
  = "h-9 w-9 shrink-0 rounded-full text-white/92 transition hover:text-white active:scale-95 max-sm:h-11 max-sm:w-11"
const activeButtonClass = "text-white bg-white/10"

export function IconButton(props: {
  label: string
  icon?: IconName
  customIcon?: JSX.Element
  iconClass?: JSX.ClassValue
  class?: JSX.ClassValue
  disabled?: boolean
  pressed?: boolean
  title?: string
  hasPopup?: "menu" | "listbox"
  expanded?: boolean
  controls?: string
  onClick?: () => void
  onKeyDown?: JSX.EventHandlerUnion<HTMLButtonElement, KeyboardEvent>
}) {
  return (
    <LiquidGlass
      class={[iconButtonClass, props.pressed && activeButtonClass, props.disabled && "opacity-40", props.class]}
      cornerRadius={999}
      elasticity={0.18}
      active={props.pressed}
      castShadow={false}
    >
      <button
        type="button"
        disabled={props.disabled}
        aria-label={props.label}
        aria-pressed={props.pressed === undefined ? undefined : props.pressed ? "true" : "false"}
        aria-haspopup={props.hasPopup}
        aria-expanded={props.expanded === undefined ? undefined : props.expanded ? "true" : "false"}
        aria-controls={props.controls}
        title={props.title}
        class="relative grid h-full w-full place-items-center rounded-full border-0 bg-transparent p-0 text-inherit disabled:cursor-wait"
        onClick={props.onClick}
        onKeyDown={props.onKeyDown}
      >
        <Show when={props.customIcon} fallback={props.icon && <Icon name={props.icon} class={props.iconClass} />}>
          {icon => icon()}
        </Show>
        <Show when={props.pressed}>
          <LiquidGlass
            class="pointer-events-none !absolute bottom-1 h-1.5 w-1.5 rounded-full"
            style={{ left: "calc(50% - 0.1875rem)" }}
            cornerRadius={999}
            elasticity={0}
            active
            castShadow={false}
          >
            <span class="block h-full w-full rounded-full border border-white/34 bg-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_0_5px_rgba(255,255,255,0.18)]"></span>
          </LiquidGlass>
        </Show>
      </button>
    </LiquidGlass>
  )
}
