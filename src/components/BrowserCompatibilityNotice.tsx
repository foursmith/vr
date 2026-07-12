export function BrowserCompatibilityNotice() {
  return (
    <aside class="flex max-w-lg flex-col items-center gap-3">
      <div aria-hidden="true" class="h-px w-12 bg-gradient-to-r from-transparent via-accent/38 to-transparent" />
      <div class="flex flex-col items-center gap-0.5">
        <p class="text-sm font-normal tracking-[-0.01em] text-[#e8fffd]/88 sm:text-base">
          <span class="font-serif italic text-[#b9fffb]/92">Chrome</span>
          {" "}
          recommended
        </p>
        <p class="max-w-sm text-[10px] font-medium leading-4 tracking-[0.018em] text-white/38 sm:text-[11px]">VR Video playback may fail or stutter in this browser.</p>
      </div>
    </aside>
  )
}
