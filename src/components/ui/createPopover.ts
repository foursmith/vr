import { onSettled } from "solid-js"

export function createPopover(props: {
  open: () => boolean
  trigger: () => HTMLElement | undefined
  panel: () => HTMLElement | undefined
  close: () => void
  updatePosition: () => void
}) {
  const closeIfOutside = (target: EventTarget | null) => {
    if (
      props.open()
      && target instanceof Node
      && !props.trigger()?.contains(target)
      && !props.panel()?.contains(target)
    ) {
      props.close()
    }
  }

  onSettled(() => {
    const onPointerDown = (event: PointerEvent) => closeIfOutside(event.target)
    const onFocusIn = (event: FocusEvent) => closeIfOutside(event.target)
    const onResize = () => {
      if (props.open()) props.updatePosition()
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("focusin", onFocusIn)
    window.addEventListener("resize", onResize)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("focusin", onFocusIn)
      window.removeEventListener("resize", onResize)
    }
  })
}
