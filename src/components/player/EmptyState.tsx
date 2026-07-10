import { Icon } from '../ui/Icon'
import { LiquidGlass } from '../ui/LiquidGlass'

export function EmptyState(props: { onChooseFiles: () => void; onChooseFolder: () => void }) {
  return (
    <section class="absolute inset-0 z-10 grid h-full w-full place-items-center bg-black px-6 text-center text-white">
      <span class="grid -translate-y-[17dvh] justify-items-center gap-6">
        <img src="/icon.svg" alt="Face Cam VR" class="h-24 w-24 drop-shadow-[0_18px_44px_rgba(0,0,0,0.5)] sm:h-32 sm:w-32" />
        <span class="grid gap-3">
          <span class="text-balance text-xl font-semibold tracking-normal sm:text-2xl">Drop video files or folders here</span>
          <span class="text-balance text-xs font-medium text-white/58 sm:text-sm">or choose what to add</span>
        </span>
        <LiquidGlass
          class="h-10 w-64 rounded-full text-white"
          cornerRadius={999}
          displacementScale={34}
          blurAmount={0.055}
          saturation={150}
          aberrationIntensity={2.2}
          elasticity={0.12}
          castShadow={false}
        >
          <div class="flex h-full w-full items-center">
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-l-full border-0 bg-transparent px-3 text-xs font-semibold text-white/82 transition hover:bg-white/7 hover:text-white focus-visible:bg-white/10 focus-visible:outline-none"
              onClick={props.onChooseFiles}
            >
              <Icon name="file-video" class="h-3.5 w-3.5" />
              Choose files
            </button>
            <span aria-hidden="true" class="h-4 w-px shrink-0 bg-white/12"></span>
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-r-full border-0 bg-transparent px-3 text-xs font-semibold text-white/82 transition hover:bg-white/7 hover:text-white focus-visible:bg-white/10 focus-visible:outline-none"
              onClick={props.onChooseFolder}
            >
              <Icon name="folder" class="h-3.5 w-3.5" />
              Choose folder
            </button>
          </div>
        </LiquidGlass>
      </span>
    </section>
  )
}
