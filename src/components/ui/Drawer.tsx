import type { Element } from "solid-js"
import { Portal } from "@solidjs/web"
import { createEffect, onSettled } from "solid-js"

const DISMISS_DISTANCE = 96
const DISMISS_VELOCITY = 0.55

export function Drawer(props: {
  open: boolean
  mount?: HTMLElement
  titleId: string
  descriptionId?: string
  children: Element
  onOpenChange: (open: boolean) => void
}) {
  let popup: HTMLDivElement | undefined
  let backdrop: HTMLDivElement | undefined
  let handle: HTMLDivElement | undefined
  let dragStartY = 0
  let dragStartTime = 0
  let dragOffset = 0
  let dragging = false

  const renderedOffset = () => dragOffset <= 180
    ? dragOffset
    : 180 + (dragOffset - 180) * 0.42

  const resetDrag = () => {
    dragging = false
    dragOffset = 0
    popup?.style.removeProperty("transform")
    popup?.style.removeProperty("transition")
    backdrop?.style.removeProperty("opacity")
  }

  const startDrag = (clientY: number) => {
    dragging = true
    dragStartY = clientY
    dragStartTime = performance.now()
    dragOffset = 0
    if (popup) popup.style.transition = "none"
  }

  const updateDrag = (clientY: number) => {
    if (!dragging || !popup) return
    dragOffset = Math.max(0, clientY - dragStartY)
    popup.style.transform = `translate3d(0, ${renderedOffset()}px, 0)`
    if (backdrop) backdrop.style.opacity = `${Math.max(0, 1 - renderedOffset() / 360)}`
  }

  const finishDrag = (clientY?: number) => {
    if (!dragging) return
    if (clientY !== undefined) dragOffset = Math.max(0, clientY - dragStartY)
    const elapsed = Math.max(1, performance.now() - dragStartTime)
    const shouldDismiss = dragOffset >= DISMISS_DISTANCE || dragOffset / elapsed >= DISMISS_VELOCITY
    resetDrag()
    if (shouldDismiss) props.onOpenChange(false)
  }

  const beginPointerDrag = (event: PointerEvent) => {
    if (event.pointerType === "touch" || (event.pointerType === "mouse" && event.button !== 0)) return
    startDrag(event.clientY)
    popup?.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const movePointerDrag = (event: PointerEvent) => {
    if (event.pointerType === "touch") return
    updateDrag(event.clientY)
    if (dragging) event.preventDefault()
  }

  const endPointerDrag = (event: PointerEvent) => {
    if (event.pointerType === "touch") return
    popup?.releasePointerCapture(event.pointerId)
    finishDrag(event.clientY)
  }

  const beginTouchDrag = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (!touch) return
    startDrag(touch.clientY)
    event.preventDefault()
  }

  const moveTouchDrag = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (!touch) return
    updateDrag(touch.clientY)
    event.preventDefault()
  }

  const endTouchDrag = (event: TouchEvent) => {
    const touch = event.changedTouches[0]
    finishDrag(touch?.clientY)
    event.preventDefault()
  }

  createEffect(
    () => props.open,
    (open) => {
      resetDrag()
      if (open) queueMicrotask(() => popup?.focus())
    },
  )

  onSettled(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!props.open || event.key !== "Escape") return
      event.preventDefault()
      props.onOpenChange(false)
    }
    const dragHandle = handle
    document.addEventListener("keydown", onKeyDown)
    dragHandle?.addEventListener("touchstart", beginTouchDrag, { passive: false })
    dragHandle?.addEventListener("touchmove", moveTouchDrag, { passive: false })
    dragHandle?.addEventListener("touchend", endTouchDrag, { passive: false })
    dragHandle?.addEventListener("touchcancel", endTouchDrag, { passive: false })
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      dragHandle?.removeEventListener("touchstart", beginTouchDrag)
      dragHandle?.removeEventListener("touchmove", moveTouchDrag)
      dragHandle?.removeEventListener("touchend", endTouchDrag)
      dragHandle?.removeEventListener("touchcancel", endTouchDrag)
    }
  })

  return (
    <Portal mount={props.mount}>
      <div
        class={`drawer-root fixed inset-0 z-60 ${props.open ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={props.open ? undefined : "true"}
        inert={!props.open}
        data-open={props.open ? "true" : "false"}
      >
        <div
          ref={backdrop}
          class="drawer-backdrop absolute inset-0 bg-black/50"
          onPointerDown={() => props.onOpenChange(false)}
        >
        </div>
        <div class="absolute inset-0 flex items-end justify-center pointer-events-none">
          <div
            ref={popup}
            role="dialog"
            aria-modal="true"
            aria-labelledby={props.titleId}
            aria-describedby={props.descriptionId}
            tabindex="-1"
            class="drawer-popup pointer-events-auto relative max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-hidden rounded-t-[28px] bg-[#0b0c0e] text-white shadow-[0_-20px_70px_rgba(0,0,0,.42)] outline-none"
          >
            <div
              ref={handle}
              class="drawer-handle-zone absolute inset-x-0 top-0 z-10 flex h-11 touch-none items-start justify-center pt-2 cursor-grab active:cursor-grabbing"
              aria-hidden="true"
              onPointerDown={beginPointerDrag}
              onPointerMove={movePointerDrag}
              onPointerUp={endPointerDrag}
              onPointerCancel={endPointerDrag}
            >
              <span class="h-1 w-10 rounded-full bg-white/20"></span>
            </div>
            {props.children}
          </div>
        </div>
      </div>
    </Portal>
  )
}
