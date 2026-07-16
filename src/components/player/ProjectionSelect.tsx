import { PROJECTION_OPTIONS } from "@foursmith/player-core/config"
import { Portal } from "@solidjs/web"
import { createSignal, For } from "solid-js"
import { createPopover } from "../ui/createPopover"
import { IconButton } from "../ui/IconButton"
import { LiquidGlass } from "../ui/LiquidGlass"
import { ProjectionIcon } from "../ui/ProjectionIcon"

export function ProjectionSelect(props: {
  value: number
  mount: HTMLElement
  onChange: (value: number) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [focusedIndex, setFocusedIndex] = createSignal(0)
  const [menuPosition, setMenuPosition] = createSignal({ x: 0, bottom: 0 })
  let root: HTMLDivElement | undefined
  let list: HTMLDivElement | undefined

  const currentProjection = () => PROJECTION_OPTIONS[props.value] ?? PROJECTION_OPTIONS[0]
  const close = () => setOpen(false)
  const updateMenuPosition = () => {
    const bounds = root?.getBoundingClientRect()
    if (!bounds) return
    setMenuPosition({ x: bounds.left + bounds.width / 2, bottom: window.innerHeight - bounds.top + 10 })
  }
  const openMenu = () => {
    const selectedIndex = props.value
    updateMenuPosition()
    setFocusedIndex(selectedIndex)
    setOpen(true)
    queueMicrotask(() => list?.querySelector<HTMLButtonElement>(`[data-index="${selectedIndex}"]`)?.focus())
  }
  const toggle = () => {
    if (open()) close()
    else openMenu()
  }
  const select = (index: number) => {
    props.onChange(index)
    setFocusedIndex(index)
    close()
  }
  const moveFocus = (delta: number) => {
    const next = (focusedIndex() + delta + PROJECTION_OPTIONS.length) % PROJECTION_OPTIONS.length
    setFocusedIndex(next)
    list?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus()
  }

  createPopover({
    open,
    trigger: () => root,
    panel: () => list,
    close,
    updatePosition: updateMenuPosition,
  })

  return (
    <div ref={root} class="relative shrink-0">
      <IconButton
        label="Projection"
        customIcon={<ProjectionIcon projection={currentProjection().component} class="h-4.5 w-4.5" />}
        hasPopup="listbox"
        expanded={open()}
        title={`Projection: ${currentProjection().label}`}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            if (!open()) openMenu()
            else moveFocus(event.key === "ArrowDown" ? 1 : -1)
          } else if (event.key === "Escape") {
            close()
          }
        }}
      />

      <Portal mount={props.mount}>
        {open() && (
          <LiquidGlass
            class="!fixed z-50 h-72 w-52 rounded-2xl text-white"
            style={{
              left: `clamp(0.75rem, calc(${menuPosition().x}px - 6.5rem), calc(100vw - 13.75rem))`,
              bottom: `${menuPosition().bottom}px`,
            }}
            cornerRadius={16}
            elasticity={0.08}
            castShadow
          >
            <div
              ref={list}
              role="listbox"
              aria-label="Projection"
              class="grid h-full w-full gap-1 p-1.5"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault()
                  moveFocus(event.key === "ArrowDown" ? 1 : -1)
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault()
                  const next = event.key === "Home" ? 0 : PROJECTION_OPTIONS.length - 1
                  setFocusedIndex(next)
                  list?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus()
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  close()
                  root?.querySelector<HTMLButtonElement>(":scope > button")?.focus()
                }
              }}
            >
              <For each={PROJECTION_OPTIONS}>
                {(projection, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index() === props.value ? "true" : "false"}
                    data-index={index()}
                    class={[
                      "flex min-h-0 w-full items-center gap-3 rounded-xl border-0 px-2.5 text-left text-xs font-medium outline-none",
                      index() === props.value
                        ? "bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.1)]"
                        : "bg-transparent text-white/68 hover:!bg-white/7 hover:text-white focus-visible:!bg-white/10 focus-visible:text-white",
                    ]}
                    onFocus={() => setFocusedIndex(index())}
                    onClick={() => select(index())}
                  >
                    <ProjectionIcon projection={projection.component} class="h-4.5 w-4.5 shrink-0" />
                    <span class="flex-1">{projection.label}</span>
                    {index() === props.value && <span aria-hidden="true" class="i-ph-check h-4 w-4 text-white/72"></span>}
                  </button>
                )}
              </For>
            </div>
          </LiquidGlass>
        )}
      </Portal>
    </div>
  )
}
