import type { Element } from "solid-js"
import { Portal } from "@solidjs/web"
import { createEffect, onSettled } from "solid-js"

export function Modal(props: {
  open: boolean
  mount?: HTMLElement
  titleId: string
  descriptionId?: string
  children: Element
  onOpenChange: (open: boolean) => void
}) {
  let popup: HTMLDivElement | undefined

  createEffect(
    () => props.open,
    (open) => {
      if (open) queueMicrotask(() => popup?.focus())
    },
  )

  onSettled(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!props.open || event.key !== "Escape") return
      event.preventDefault()
      props.onOpenChange(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  })

  return (
    <Portal mount={props.mount}>
      <div
        class={`modal-root fixed inset-0 z-60 grid place-items-center p-4 ${props.open ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={props.open ? undefined : "true"}
        inert={!props.open}
        data-open={props.open ? "true" : "false"}
      >
        <div class="modal-backdrop absolute inset-0 bg-black/50" onPointerDown={() => props.onOpenChange(false)}></div>
        <div
          ref={popup}
          role="dialog"
          aria-modal="true"
          aria-labelledby={props.titleId}
          aria-describedby={props.descriptionId}
          tabindex="-1"
          class="modal-popup relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-hidden rounded-[24px] bg-[#0b0c0e] text-white shadow-[0_24px_90px_rgba(0,0,0,.5)] outline-none"
        >
          {props.children}
        </div>
      </div>
    </Portal>
  )
}
