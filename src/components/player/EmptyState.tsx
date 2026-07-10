import { MediaPickerButtons } from '../ui/MediaPickerButtons'

export function EmptyState(props: { onChooseFiles: () => void; onChooseFolder: () => void }) {
  return (
    <section class="absolute inset-0 z-10 grid h-full w-full place-items-center bg-black px-6 text-center text-white">
      <span class="grid -translate-y-[17dvh] justify-items-center gap-6">
        <img src="/icon.svg" alt="Face Cam VR" class="h-24 w-24 drop-shadow-[0_18px_44px_rgba(0,0,0,0.5)] sm:h-32 sm:w-32" />
        <span class="grid gap-3">
          <span class="text-balance text-xl font-semibold tracking-normal sm:text-2xl">Drop video files or folders here</span>
          <span class="text-balance text-xs font-medium text-white/58 sm:text-sm">or choose what to add</span>
        </span>
        <MediaPickerButtons onChooseFiles={props.onChooseFiles} onChooseFolder={props.onChooseFolder} />
      </span>
    </section>
  )
}
