import { For, Show } from 'solid-js'
import type { DebugFace } from '../../features/face-tracking/debug-detector'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'

export function DebugPanel(props: {
  status: string
  imageUrl?: string
  faces: DebugFace[]
  setImage: (element: HTMLImageElement) => void
  onImageLoad: () => void
  onUpload: () => void
  onClose: () => void
}) {
  return (
    <section class="pointer-events-auto absolute right-3 top-3 z-30 grid max-h-[calc(100dvh-1.5rem)] w-[min(28rem,calc(100vw-1.5rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-white/14 bg-neutral-950/72 text-white shadow-[0_18px_70px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.13)] backdrop-blur-2xl sm:right-6 sm:top-6">
      <div class="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
        <div class="min-w-0">
          <p class="truncate text-xs font-semibold text-white/88">{props.status}</p>
          <p class="truncate font-mono text-[10px] text-white/45">local full-range model</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/18 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
            onClick={props.onUpload}
          >
            <Icon name="upload" class="h-3.5 w-3.5" />
            Upload
          </button>
          <IconButton label="Close debug panel" icon="x" iconClass="h-4 w-4" onClick={props.onClose} />
        </div>
      </div>

      <div class="min-h-56 overflow-auto p-3">
        <Show
          when={props.imageUrl}
          fallback={
            <button
              type="button"
              class="grid min-h-52 w-full place-items-center rounded-lg border border-dashed border-white/18 bg-white/6 px-4 text-sm font-semibold text-white/72 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
              onClick={props.onUpload}
            >
              Upload image
            </button>
          }
        >
          {(url) => (
            <div class="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg border border-white/10 bg-black">
              <img
                ref={props.setImage}
                src={url()}
                alt=""
                class="block max-h-[62dvh] max-w-full object-contain"
                onLoad={props.onImageLoad}
              />
              <For each={props.faces}>
                {(face) => (
                  <div
                    class="absolute rounded border-2 border-[#38ff8b] shadow-[0_0_0_1px_rgba(0,0,0,0.74),0_0_18px_rgba(56,255,139,0.38),inset_0_0_0_1px_rgba(0,0,0,0.42)]"
                    style={{
                      left: `${face.x * 100}%`,
                      top: `${face.y * 100}%`,
                      width: `${face.width * 100}%`,
                      height: `${face.height * 100}%`,
                    }}
                  >
                    <span class="absolute -left-0.5 top-[-1.35rem] rounded-t bg-[#0a84ff]/90 px-1.25 py-1 font-mono text-[10px] text-white font-bold leading-none [text-shadow:0_1px_1px_rgba(0,0,0,0.45)]">
                      {Math.round(face.score * 100)}%
                    </span>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
      </div>
    </section>
  )
}
