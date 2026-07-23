import type { PlayerController } from "../../features/player/controller"
import { Show, untrack } from "solid-js"
import { t } from "../../i18n"
import { IconButton } from "../ui/IconButton"
import { ControlSliderPopover } from "./ControlSliderPopover"
import { PlaybackTimeline } from "./PlaybackTimeline"
import { ProjectionSelect } from "./ProjectionSelect"

export function PlayerControls(props: { controller: PlayerController }) {
  const controller = untrack(() => props.controller)
  let adjustmentsButton!: HTMLDivElement
  const { controls, display, playback, subtitles } = controller
  const {
    controlsVisible,
    registerUiSurface,
    setControlsPanel,
    setControlsHold,
    toggleSlider,
  } = controls
  const {
    canPlayNext,
    playNext,
    playing,
    togglePlay,
  } = playback
  const {
    fullscreen,
    pictureInPicture,
    pictureInPictureSupported,
    setProjectionId,
    state: displayState,
    toggleFullscreen,
    togglePictureInPicture,
  } = display
  return (
    <aside
      class="player-controls pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3 sm:p-6"
    >
      <div
        ref={[setControlsPanel, registerUiSurface]}
        class={[
          "relative mx-auto grid max-w-6xl gap-3 overflow-visible rounded-[24px] bg-transparent p-2 text-white shadow-none transition-[transform,opacity] duration-300 ease-[cubic-bezier(.22,.8,.24,1)] sm:p-4",
          controlsVisible() ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
        ]}
        onFocusIn={(event) => {
          setControlsHold("focus", (event.target as HTMLElement).matches(":focus-visible"))
        }}
        onFocusOut={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setControlsHold("focus", false)
        }}
      >
        <ControlSliderPopover controller={controller} trigger={() => adjustmentsButton} />
        <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 max-sm:gap-2">
          <div class="flex items-center gap-3 justify-self-start max-sm:gap-2">
            <IconButton
              label={playing() ? t("controls.pause") : t("controls.play")}
              icon={playing() ? "pause" : "play"}
              iconClass={playing() ? "h-6.5 w-6.5" : "h-6.5 w-6.5 translate-x-0.5"}
              class="!h-12 !w-12 text-white/94 max-sm:!h-14 max-sm:!w-14"
              onClick={togglePlay}
            />
            <Show when={canPlayNext()}>
              <IconButton label={t("controls.nextVideo")} icon="skip-forward" onClick={playNext} />
            </Show>
          </div>

          <div class="flex min-w-0 items-center justify-end gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden">
            <Show when={subtitles.hasSubtitle()}>
              <IconButton
                label={subtitles.enabled() ? t("controls.hideSubtitles") : t("controls.showSubtitles")}
                icon="subtitles"
                pressed={subtitles.enabled()}
                onClick={subtitles.toggle}
              />
            </Show>
            <ProjectionSelect value={displayState.projectionId} mount={controller.frame.getPlayer()} onChange={setProjectionId} />
            <div ref={adjustmentsButton} class="shrink-0">
              <IconButton
                label={t("controls.adjustVolumeSpeed")}
                icon="sliders"
                onClick={() => toggleSlider("adjustments", adjustmentsButton)}
              />
            </div>
            <Show when={pictureInPictureSupported}>
              <IconButton
                label={pictureInPicture() ? t("controls.exitPip") : t("controls.enterPip")}
                icon="picture-in-picture"
                pressed={pictureInPicture()}
                onClick={() => void togglePictureInPicture()}
              />
            </Show>
            <IconButton
              label={fullscreen() ? t("controls.exitFullscreen") : t("controls.enterFullscreen")}
              icon={fullscreen() ? "corners-in" : "corners-out"}
              pressed={fullscreen()}
              onClick={() => void toggleFullscreen()}
            />
          </div>
        </div>

        <PlaybackTimeline controller={controller} />
      </div>
    </aside>
  )
}
