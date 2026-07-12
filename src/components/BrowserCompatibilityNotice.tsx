export function BrowserCompatibilityNotice() {
  return (
    <aside class="mt-5 flex max-w-lg flex-col items-center sm:mt-6">
      <div aria-hidden="true" class="mb-3 h-px w-12 bg-gradient-to-r from-transparent via-accent/38 to-transparent" />
      <p class="text-sm font-normal tracking-[-0.01em] text-[#e8fffd]/88 sm:text-base">
        <span class="font-serif italic text-[#b9fffb]/92">Chrome</span>
        {" "}
        &
        {" "}
        <span class="font-serif italic text-[#b9fffb]/92">Chromium</span>
        {" "}
        recommended
      </p>
      <p class="mt-0 max-w-sm text-[10px] font-medium leading-4 tracking-[0.018em] text-white/38 sm:text-[11px]">VR Video playback may fail or stutter in this browser.</p>
    </aside>
  )
}
