import { MediaPickerButtons } from "../ui/MediaPickerButtons"
import { OceanBackground } from "./OceanBackground"

export function EmptyState(props: { onChooseFiles: () => void, onChooseFolder: () => void }) {
  return (
    <section class="empty-state-bg absolute inset-0 z-10 box-border flex h-full w-full items-center justify-center overflow-hidden px-5 pb-34 pt-8 text-center text-white sm:px-10 sm:pb-40 sm:pt-12">
      <OceanBackground />
      <div class="empty-state-content relative flex w-full max-w-3xl flex-col items-center">
        <div class="relative h-58 w-80 sm:h-66 sm:w-92">
          <svg aria-hidden="true" viewBox="0 0 240 240" class="empty-depth-rings absolute left-1/2 top-1/2 h-58 w-58 overflow-visible sm:h-68 sm:w-68">
            <defs>
              <linearGradient id="depth-ring-inner" x1="52" y1="42" x2="186" y2="194" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#d9fffc" stop-opacity="0.12" />
                <stop offset="0.42" stop-color="currentColor" stop-opacity="0.62" class="text-accent" />
                <stop offset="1" stop-color="#62cfd8" stop-opacity="0.16" />
              </linearGradient>
              <linearGradient id="depth-ring-outer" x1="32" y1="24" x2="208" y2="216" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="currentColor" stop-opacity="0.04" class="text-accent" />
                <stop offset="0.56" stop-color="#62cfd8" stop-opacity="0.24" />
                <stop offset="1" stop-color="#62cfd8" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            <circle cx="120" cy="120" r="72" fill="none" stroke="url(#depth-ring-inner)" stroke-width="1.35" stroke-linecap="round" stroke-dasharray="4 6" opacity="0.92" transform="rotate(5 120 120)" />
            <circle cx="120" cy="120" r="86" fill="none" stroke="url(#depth-ring-outer)" stroke-width="1" stroke-linecap="round" stroke-dasharray="3 8" opacity="0.76" transform="rotate(18 120 120)" />
            <circle cx="120" cy="120" r="100" fill="none" stroke="url(#depth-ring-outer)" stroke-width="0.72" stroke-linecap="round" stroke-dasharray="2 11" opacity="0.56" transform="rotate(32 120 120)" />
            <circle cx="120" cy="120" r="114" fill="none" stroke="url(#depth-ring-outer)" stroke-width="0.48" stroke-linecap="round" stroke-dasharray="1.5 14" opacity="0.36" transform="rotate(48 120 120)" />
          </svg>
          <img src="/icon.svg" alt="Foursmith VR" class="absolute left-1/2 top-1/2 z-10 h-40 w-40 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_16px_40px_rgba(70,205,205,.2)] sm:h-48 sm:w-48" />

          <div class="empty-orbit-badges absolute inset-0 z-20">
            <a
              href="https://github.com/foursmith/vr"
              target="_blank"
              rel="noreferrer"
              aria-label="View foursmith/vr on GitHub"
              class="empty-orbit-badge empty-github-badge empty-orbit-badge-5 absolute -top-2 left-30 sm:-top-3 sm:left-36"
            >
              <img
                src="https://img.shields.io/github/stars/foursmith/vr?style=flat-square&logo=github&logoColor=b9fffb&label=Open%20Source&color=176d73&labelColor=0c373d"
                alt="GitHub stars"
              />
            </a>
            <span class="empty-orbit-badge empty-orbit-badge-1 absolute left-5 top-3 sm:left-8 sm:top-2">
              <i aria-hidden="true"></i>
              Elegant
            </span>
            <span class="empty-orbit-badge empty-orbit-badge-2 absolute right-0 top-16 sm:-right-1 sm:top-19">
              <i aria-hidden="true"></i>
              No headset needed
            </span>
            <span class="empty-orbit-badge empty-orbit-badge-3 absolute bottom-1 right-8 sm:bottom-0 sm:right-11">
              <i aria-hidden="true"></i>
              2D VR player
            </span>
            <span class="empty-orbit-badge empty-orbit-badge-4 absolute bottom-12 left-0 sm:bottom-14 sm:-left-1">
              <i aria-hidden="true"></i>
              Face follow
            </span>
          </div>
        </div>

        <div class="relative z-10 mt-3 flex flex-col items-center sm:mt-4">
          <h1 class="flex items-center gap-2.5 text-[10px] font-medium tracking-[0.18em] sm:text-[11px] sm:tracking-[0.21em]">
            <span class="text-[#d9fffc]/72">Foursmith VR</span>
            <span aria-hidden="true" class="h-0.5 w-0.5 rounded-full bg-accent/38"></span>
            <span class="italic text-[#b9fffb]/42">Watch VR like TikTok LIVE</span>
          </h1>
          <div class="mt-5 sm:mt-6">
            <MediaPickerButtons onChooseFiles={props.onChooseFiles} onChooseFolder={props.onChooseFolder} />
          </div>
          <p class="mt-1.5 text-[10px] font-medium text-white/26 sm:text-[11px]">Drop video files or folders here</p>
        </div>
      </div>
    </section>
  )
}
