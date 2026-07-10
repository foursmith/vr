export function UnsupportedBrowser() {
  return (
    <main class="grid min-h-dvh place-items-center bg-black px-5 text-white">
      <section class="grid max-w-lg gap-4 text-center">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-white/48">Unsupported browser</p>
        <h1 class="text-2xl font-semibold sm:text-3xl">Switch to a Chromium browser</h1>
        <p class="text-base leading-7 text-white/72">For the best experience, use Chrome or another Chromium-based browser.</p>
      </section>
    </main>
  )
}
