import { onCleanup } from 'solid-js'
import { Portal } from '@solidjs/web'
import { Icon } from './Icon'

export function createMediaDropTip() {
  let element: HTMLDivElement | undefined
  let position = { x: 0, y: 0 }
  const applyPosition = () => {
    if (element) element.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`
  }
  const setElement = (nextElement: HTMLDivElement | undefined) => {
    element = nextElement
    applyPosition()
  }
  const updatePosition = (event: DragEvent) => {
    position = {
      x: Math.max(8, Math.min(event.clientX + 14, window.innerWidth - 128)),
      y: Math.max(8, Math.min(event.clientY + 18, window.innerHeight - 40)),
    }
    applyPosition()
  }
  return { setElement, updatePosition }
}

export function MediaDropTip(props: { controller: ReturnType<typeof createMediaDropTip> }) {
  onCleanup(() => props.controller.setElement(undefined))
  return (
    <Portal>
      <div
        ref={(element) => props.controller.setElement(element)}
        role="status"
        class="pointer-events-none fixed left-0 top-0 z-50 flex will-change-transform items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/12 bg-[#171719]/94 px-2.5 py-2 text-[11px] font-medium text-white/88 shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
      >
        <Icon name="folder" class="h-3.5 w-3.5 text-[#80c7ff]" />
        Release to add
      </div>
    </Portal>
  )
}
