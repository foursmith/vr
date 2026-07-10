import { Show } from 'solid-js'
import { Icon, type IconName } from './Icon'
import { LiquidGlass } from './LiquidGlass'

const iconButtonClass =
  'h-9 w-9 shrink-0 rounded-full text-white/92 transition hover:text-white active:scale-95'
const activeButtonClass = 'text-white bg-white/10'

export function IconButton(props: {
  label: string
  icon: IconName
  iconClass?: string
  class?: string
  pressed?: boolean
  onClick?: () => void
}) {
  return (
    <LiquidGlass
      class={[iconButtonClass, props.pressed && activeButtonClass, props.class]}
      cornerRadius={999}
      displacementScale={34}
      blurAmount={0.055}
      saturation={150}
      aberrationIntensity={2.2}
      elasticity={0.18}
      active={props.pressed}
      castShadow={false}
    >
      <button
        type="button"
        aria-label={props.label}
        aria-pressed={props.pressed === undefined ? undefined : props.pressed ? 'true' : 'false'}
        class="relative grid h-full w-full cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-inherit transition focus-visible:bg-white/12 focus-visible:outline-none"
        onClick={props.onClick}
      >
        <Icon name={props.icon} class={props.iconClass} />
        <Show when={props.pressed}>
          <LiquidGlass
            class="pointer-events-none !absolute bottom-1 h-1.5 w-1.5 rounded-full"
            style={{ left: 'calc(50% - 0.1875rem)' }}
            cornerRadius={999}
            displacementScale={8}
            blurAmount={0.04}
            saturation={155}
            aberrationIntensity={1.2}
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
