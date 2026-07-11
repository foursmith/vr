import type { JSX } from "@solidjs/web"
import { createEffect, createMemo, createSignal } from "solid-js"

type ClassValue = string | false | undefined | Array<string | false | undefined>

interface LiquidGlassProps {
  children: JSX.Element
  class?: ClassValue
  style?: JSX.CSSProperties | string
  onMouseEnter?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>
  onMouseLeave?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>
  onFocusIn?: JSX.EventHandlerUnion<HTMLDivElement, FocusEvent>
  onFocusOut?: JSX.EventHandlerUnion<HTMLDivElement, FocusEvent>
  elasticity?: number
  cornerRadius?: number
  active?: boolean
  castShadow?: boolean
}

export function LiquidGlass(props: LiquidGlassProps) {
  const [glassElement, setGlassElement] = createSignal<HTMLDivElement>()
  const [glassSize, setGlassSize] = createSignal({ width: 1, height: 1 })
  const [globalMousePos, setGlobalMousePos] = createSignal({ x: 0, y: 0 })

  const elasticity = () => props.elasticity ?? 0.12
  const cornerRadius = () => props.cornerRadius ?? 24
  const active = () => props.active ?? false
  const castShadow = () => props.castShadow ?? true

  const fadeInFactor = createMemo(() => {
    const mouse = globalMousePos()
    const element = glassElement()
    if (!mouse.x || !mouse.y || !element) return 0

    const rect = element.getBoundingClientRect()
    const edgeDistanceX = Math.max(0, Math.abs(mouse.x - (rect.left + rect.width / 2)) - glassSize().width / 2)
    const edgeDistanceY = Math.max(0, Math.abs(mouse.y - (rect.top + rect.height / 2)) - glassSize().height / 2)
    const edgeDistance = Math.hypot(edgeDistanceX, edgeDistanceY)
    const activationZone = 200

    return edgeDistance > activationZone ? 0 : 1 - edgeDistance / activationZone
  })

  const elasticTransform = createMemo(() => {
    const mouse = globalMousePos()
    const size = glassSize()
    const element = glassElement()
    if (!mouse.x || !mouse.y || !element) return "translate3d(0, 0, 0) scale(1)"

    const rect = element.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const deltaX = mouse.x - centerX
    const deltaY = mouse.y - centerY
    const centerDistance = Math.hypot(deltaX, deltaY)

    if (centerDistance === 0) return "translate3d(0, 0, 0) scale(1)"

    const normalizedX = deltaX / centerDistance
    const normalizedY = deltaY / centerDistance
    const stretchIntensity = Math.min(centerDistance / 300, 1) * elasticity() * fadeInFactor()
    const scaleX = 1 + Math.abs(normalizedX) * stretchIntensity * 0.3 - Math.abs(normalizedY) * stretchIntensity * 0.15
    const scaleY = 1 + Math.abs(normalizedY) * stretchIntensity * 0.3 - Math.abs(normalizedX) * stretchIntensity * 0.15
    const x = deltaX * elasticity() * 0.1 * fadeInFactor()
    const y = deltaY * elasticity() * 0.1 * fadeInFactor()

    if (size.width <= 1 || size.height <= 1) return "translate3d(0, 0, 0) scale(1)"
    return `translate3d(${x}px, ${y}px, 0) scaleX(${Math.max(0.8, scaleX)}) scaleY(${Math.max(0.8, scaleY)})`
  })

  const shellStyle = createMemo<JSX.CSSProperties>(() => ({
    "border-radius": `${cornerRadius()}px`,
    "transform": elasticTransform(),
    "transition": "transform 72ms ease-out",
  }))

  const updateMouse = (event: MouseEvent) => {
    setGlobalMousePos({ x: event.clientX, y: event.clientY })
  }

  createEffect(glassElement, (element) => {
    if (!element) return
    const updateSize = () => {
      const rect = element.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      setGlassSize(current => (current.width === width && current.height === height ? current : { width, height }))
    }
    const resizeObserver = new ResizeObserver(updateSize)

    updateSize()
    resizeObserver.observe(element)
    window.addEventListener("resize", updateSize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", updateSize)
    }
  })

  createEffect(glassElement, (element) => {
    if (!element) return

    element.addEventListener("mouseenter", updateMouse)
    element.addEventListener("mousemove", updateMouse)
    return () => {
      element.removeEventListener("mouseenter", updateMouse)
      element.removeEventListener("mousemove", updateMouse)
    }
  })

  return (
    <div
      ref={setGlassElement}
      class={["relative isolate overflow-visible", props.class]}
      style={props.style}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      onFocusIn={props.onFocusIn}
      onFocusOut={props.onFocusOut}
    >
      <div
        class="relative grid h-full min-h-0 w-full min-w-0 origin-center overflow-hidden will-change-transform [&_button]:cursor-default [&_button]:transition [&_button:hover]:bg-white/7 [&_button:hover]:text-white [&_button:active]:scale-95 [&_button:focus-visible]:bg-white/10 [&_button:focus-visible]:outline-none"
        style={shellStyle()}
      >
        <span
          class={[
            "pointer-events-none absolute inset-0 z-1 rounded-[inherit] border border-white/14 transition-colors",
            castShadow()
              ? "shadow-[0_8px_24px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.16)]"
              : "shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]",
            active()
              ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.07)),rgba(38,40,46,0.92)]"
              : "bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.03)),rgba(12,14,18,0.88)]",
          ]}
        />
        <div class="relative z-3 grid h-full min-h-0 w-full min-w-0 place-items-center">{props.children}</div>
      </div>
    </div>
  )
}
