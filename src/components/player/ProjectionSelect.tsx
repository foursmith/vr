import { For, createSignal, onSettled } from 'solid-js'
import { Portal } from '@solidjs/web'
import { PRESETS } from '../../features/vr/scene'
import { LiquidGlass } from '../ui/LiquidGlass'
import { ProjectionIcon } from '../ui/ProjectionIcon'

export function ProjectionSelect(props: {
  value: number
  onChange: (value: number) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [focusedIndex, setFocusedIndex] = createSignal(0)
  const [menuPosition, setMenuPosition] = createSignal({ left: 0, bottom: 0 })
  let root: HTMLDivElement | undefined
  let list: HTMLDivElement | undefined

  const currentPreset = () => PRESETS[props.value] ?? PRESETS[0]
  const close = () => setOpen(false)
  const updateMenuPosition = () => {
    const bounds = root?.getBoundingClientRect()
    if (!bounds) return
    setMenuPosition({ left: bounds.left, bottom: window.innerHeight - bounds.top + 10 })
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
    const next = (focusedIndex() + delta + PRESETS.length) % PRESETS.length
    setFocusedIndex(next)
    list?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus()
  }

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Node
    if (!root?.contains(target) && !list?.contains(target)) close()
  }
  onSettled(() => {
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', updateMenuPosition)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', updateMenuPosition)
    }
  })

  return (
    <div ref={root} class="relative h-full min-w-0 flex-1">
      <button
        type="button"
        class="flex h-full w-full min-w-0 items-center gap-2 rounded-full border-0 bg-transparent px-3 py-0 text-left text-xs font-medium text-white outline-none"
        aria-label="Projection"
        aria-haspopup="listbox"
        aria-expanded={open() ? 'true' : 'false'}
        title={`Projection: ${currentPreset().label}`}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open()) openMenu()
            else moveFocus(event.key === 'ArrowDown' ? 1 : -1)
          } else if (event.key === 'Escape') {
            close()
          }
        }}
      >
        <ProjectionIcon preset={currentPreset().component} class="h-4.5 w-4.5 shrink-0 text-white/82" />
        <span class="min-w-0 flex-1 truncate">{currentPreset().label}</span>
        <span aria-hidden="true" class={`i-ph-caret-down h-3.5 w-3.5 shrink-0 text-white/62 transition-transform ${open() ? 'rotate-180' : ''}`}></span>
      </button>

      <Portal>
        {open() && (
          <LiquidGlass
            class="!fixed z-50 h-72 w-52 rounded-2xl text-white"
            style={{ left: `${menuPosition().left}px`, bottom: `${menuPosition().bottom}px` }}
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
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  moveFocus(event.key === 'ArrowDown' ? 1 : -1)
                } else if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault()
                  const next = event.key === 'Home' ? 0 : PRESETS.length - 1
                  setFocusedIndex(next)
                  list?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  close()
                  root?.querySelector<HTMLButtonElement>(':scope > button')?.focus()
                }
              }}
            >
              <For each={PRESETS}>
                {(preset, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index() === props.value ? 'true' : 'false'}
                    data-index={index()}
                    class={`flex min-h-0 w-full items-center gap-3 rounded-xl border-0 px-2.5 text-left text-xs font-medium outline-none ${
                      index() === props.value
                        ? 'bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.1)]'
                        : 'bg-transparent text-white/68 hover:!bg-white/7 hover:text-white focus-visible:!bg-white/10 focus-visible:text-white'
                    }`}
                    onFocus={() => setFocusedIndex(index())}
                    onClick={() => select(index())}
                  >
                    <ProjectionIcon preset={preset.component} class="h-4.5 w-4.5 shrink-0" />
                    <span class="flex-1">{preset.label}</span>
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
