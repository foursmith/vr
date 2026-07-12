import { isChromiumBrowser } from "../../lib/browser"
import { BrowserCompatibilityNotice } from "../BrowserCompatibilityNotice"
import { FsvrLogo } from "../ui/FsvrLogo"
import { MediaPickerButtons } from "../ui/MediaPickerButtons"
import { OceanBackground } from "./OceanBackground"

export function EmptyState(props: { onChooseFiles: () => void, onChooseFolder: () => void }) {
  return (
    <section class="empty-state-bg absolute inset-0 z-10 flex items-center justify-center overflow-hidden px-5 py-8 text-center text-white sm:px-10 sm:py-12">
      <OceanBackground />
      <div class="empty-state-content relative z-10 flex flex-col items-center gap-3 sm:gap-4">
        <div class="relative h-60 w-88 sm:h-68 sm:w-100">
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
          <FsvrLogo
            title="Foursmith VR"
            class="absolute left-1/2 top-1/2 z-10 h-40 w-40 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_16px_40px_rgba(70,205,205,.2)] sm:h-48 sm:w-48"
          />

          <div class="absolute inset-0 z-20">
            <a
              href="https://github.com/foursmith/vr"
              target="_blank"
              rel="noreferrer"
              aria-label="View foursmith/vr on GitHub"
              class="empty-orbit-badge empty-github-badge empty-orbit-badge-5"
            >
              <img
                src="https://img.shields.io/github/stars/foursmith/vr?style=flat-square&logo=github&logoColor=b9fffb&label=Open%20Source&color=176d73&labelColor=0c373d"
                alt="GitHub stars"
              />
            </a>
            <span class="empty-orbit-badge empty-orbit-badge-1">
              <i aria-hidden="true"></i>
              Elegant & Powserful
            </span>
            <span class="empty-orbit-badge empty-orbit-badge-2">
              <i aria-hidden="true"></i>
              No headset needed
            </span>
            <span class="empty-orbit-badge empty-orbit-badge-3">
              <i aria-hidden="true"></i>
              2D VR player
            </span>
            <span class="empty-orbit-badge empty-orbit-badge-4">
              <i aria-hidden="true"></i>
              Follow face
            </span>
            <span class="empty-orbit-badge empty-orbit-badge-6">
              <i aria-hidden="true"></i>
              Subtitles
            </span>
          </div>
        </div>

        <div class="flex flex-col items-center gap-8">
          <div class="flex flex-col items-center gap-5 sm:gap-6">
            <h1 class="flex items-center gap-2.5 text-[10px] font-medium tracking-[0.18em] sm:text-[11px] sm:tracking-[0.21em]">
              <span class="text-[#b9fffb]/72">Foursmith VR</span>
              <span aria-hidden="true" class="h-0.5 w-0.5 rounded-full bg-accent/38"></span>
              <span class="italic text-[#d9fffc]/42">Watch VR like TikTok LIVE</span>
            </h1>
            <div class="flex flex-col items-center gap-1.5">
              <MediaPickerButtons onChooseFiles={props.onChooseFiles} onChooseFolder={props.onChooseFolder} />
              <span class="text-[10px] font-medium leading-2 tracking-[0.018em] text-white/38 sm:text-[11px]">Drop videos here</span>
            </div>
          </div>
          {isChromiumBrowser() ? <BrowserCompatibilityNotice /> : null}
        </div>
      </div>
    </section>
  )
}
