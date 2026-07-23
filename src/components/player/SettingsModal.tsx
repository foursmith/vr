import type { PlayerController } from "../../features/player/controller"
import type { IconName } from "../ui/Icon"
import { createSignal, For, onSettled, Show, untrack } from "solid-js"
import appPackage from "../../../package.json"
import { APP_VERSION, APP_VERSION_URL } from "../../app/build-info"
import { VIDEO_FRAME_RATE_OPTIONS } from "../../features/player/controller"
import { SHORTCUT_DEFINITIONS } from "../../features/player/shortcuts"
import { projectionLabel, t } from "../../i18n"
import { Drawer } from "../ui/Drawer"
import { FsvrLogo } from "../ui/FsvrLogo"
import { Icon } from "../ui/Icon"
import { LanguagePicker } from "../ui/LanguagePicker"
import { Modal } from "../ui/Modal"
import { MatrixRange } from "../ui/RangeControls"
import { Switch } from "../ui/Switch"

const VIDEO_MATRIX_COLORS = ["#58bde2", "#5ed59a", "#efa557", "#9d74f7"]
const VIDEO_MATRIX_ROWS = VIDEO_FRAME_RATE_OPTIONS
const ABOUT_ACTION_CLASS = "flex items-center gap-1.5 rounded-full border px-2 py-1 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40"
const ABOUT_ACTION_IDLE_CLASS = "border-transparent bg-transparent text-white/42 hover:border-white/7 hover:bg-white/7 hover:text-white/72 focus-visible:border-white/7 focus-visible:bg-white/7 focus-visible:text-white/72"

function SettingToggle(props: {
  title: string
  description: string
  icon: IconName
  pressed: boolean
  disabled?: boolean
  embedded?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div
      aria-disabled={props.disabled ? "true" : undefined}
      class={[
        "group grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-1 pr-1 pl-3 text-left text-white transition-[transform,background-color,opacity]",
        props.embedded ? "rounded-none bg-transparent" : "rounded-2xl bg-white/4",
        props.disabled
          ? "opacity-42"
          : "hover:bg-white/8 active:scale-[0.992]",
      ]}
      onClick={(event) => {
        if (props.disabled || (event.target as Element).closest("button")) return
        props.onCheckedChange(!props.pressed)
      }}
    >
      <span class="grid h-8 w-8 place-items-center rounded-xl bg-white/8 text-white/78 transition group-hover:text-white">
        <Icon name={props.icon} class="h-4 w-4" />
      </span>
      <span class="min-w-0">
        <span class="block truncate text-xs font-semibold text-white/92">{props.title}</span>
        <span class="mt-0.5 block truncate text-[11px] leading-snug text-white/48">{props.description}</span>
      </span>
      <Switch
        checked={props.pressed}
        label={props.title}
        disabled={props.disabled}
        onCheckedChange={props.onCheckedChange}
      />
    </div>
  )
}

export function SettingsModal(props: { controller: PlayerController, open: boolean, onOpenChange: (open: boolean) => void }) {
  const controller = untrack(() => props.controller)
  const { debug, display, frame, playback, server } = controller
  const {
    setFaceAutoCenter,
    setQualityId,
    setRenderFrameRateId,
    setResumeFaceAutoCenterAfterViewChange,
    setSplitScreen,
    state,
  } = display
  const [narrowScreen, setNarrowScreen] = createSignal(window.matchMedia("(max-width: 639.9px)").matches)
  const videoMatrixColumns = () => [
    t("settings.quality.low"),
    t("settings.quality.medium"),
    t("settings.quality.high"),
    t("settings.quality.ultra"),
  ].map((label, index) => ({ label, color: VIDEO_MATRIX_COLORS[index]! }))
  onSettled(() => {
    const media = window.matchMedia("(max-width: 639.9px)")
    const sync = () => setNarrowScreen(media.matches)
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  })

  const content = () => (
    <div class="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto pb-[env(safe-area-inset-bottom)] pt-3 overscroll-contain">
      <div class="flex items-center justify-between px-5 py-3">
        <div>
          <h2 id="settings-title" class="font-semibold tracking-tight text-white">{t("common.settings")}</h2>
        </div>
        <button
          type="button"
          aria-label={t("settings.close")}
          class="grid h-8 w-8 place-items-center rounded-full border-0 bg-white/7 text-white/68 outline-none transition hover:!bg-white/12 hover:text-white focus-visible:!bg-white/14 max-sm:h-11 max-sm:w-11"
          onClick={() => props.onOpenChange(false)}
        >
          <Icon name="x" class="h-4 w-4" />
        </button>
      </div>

      <div class="grid gap-1.5 px-2.5 pb-2.5">
        <section class="grid gap-1.5" aria-labelledby="playback-settings-title">
          <h3 id="playback-settings-title" class="px-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/42">
            {t("settings.playback")}
          </h3>
          <div class="overflow-hidden rounded-2xl bg-white/4">
            <div
              class="grid gap-3 p-3"
              role="group"
              aria-label={t("settings.qualityAndFrameRate")}
            >
              <MatrixRange
                columns={videoMatrixColumns()}
                rows={VIDEO_MATRIX_ROWS}
                column={state.qualityId}
                row={Math.max(0, state.renderFrameRateId - 1)}
                label={t("settings.qualityMatrix")}
                cornerLabel={t("settings.renderer")}
                onChange={(qualityId, frameRateIndex) => {
                  setQualityId(qualityId)
                  setRenderFrameRateId(frameRateIndex + 1)
                }}
              />
            </div>
            <div class="border-t border-white/7">
              <SettingToggle
                title={t("settings.portraitLayout")}
                description={t("settings.portraitLayoutDescription")}
                icon="columns"
                pressed={state.splitScreen}
                embedded
                onCheckedChange={setSplitScreen}
              />
            </div>
            <Show when={server.enabled()}>
              <div class="border-t border-white/7">
                <SettingToggle
                  title={t("settings.resumeLastVideo")}
                  description={t("settings.resumeLastVideoDescription")}
                  icon="play"
                  pressed={playback.autoResumePlayback()}
                  embedded
                  onCheckedChange={playback.setAutoResumePlayback}
                />
              </div>
            </Show>
            <Show when={!narrowScreen()}>
              <details class="settings-collapsible group border-t border-white/7">
                <summary class="grid min-h-13 list-none grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-3 py-1 pl-3 pr-1 text-left transition-colors marker:hidden hover:bg-white/8">
                  <span class="grid h-8 w-8 place-items-center rounded-xl bg-white/8 text-white/78 transition group-hover:text-white">
                    <Icon name="keyboard" class="h-4 w-4" />
                  </span>
                  <div class="min-w-0">
                    <h3 class="truncate text-xs font-semibold text-white/92">{t("settings.shortcuts")}</h3>
                    <span class="mt-0.5 block truncate text-[11px] leading-snug text-white/48">{t("settings.shortcutsDescription")}</span>
                  </div>
                  <span class="grid h-8 w-8 place-items-center text-white/42 transition-colors group-hover:text-white/68">
                    <Icon name="caret-down" class="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <div class="grid grid-cols-2 gap-x-4 border-t border-white/7 px-4 py-2">
                  <For each={SHORTCUT_DEFINITIONS}>
                    {shortcut => (
                      <div class="flex min-w-0 items-center justify-between gap-2 border-b border-white/6 py-2 last:border-b-0">
                        <span class="min-w-0 truncate text-[10px] font-medium text-white/66">
                          {"labelKey" in shortcut
                            ? t(shortcut.labelKey)
                            : t("projection.current", projectionLabel(shortcut.projection))}
                        </span>
                        <kbd class="min-w-5 shrink-0 rounded-md border border-white/9 bg-black/14 px-1.5 py-1 text-center font-mono text-[9px] font-semibold text-white/72">{shortcut.key}</kbd>
                      </div>
                    )}
                  </For>
                </div>
              </details>
            </Show>
          </div>
        </section>
        <div class="grid gap-1.5 pt-2">
          <h3 id="portrait-centering-title" class="px-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/42">
            {t("settings.centering")}
          </h3>
          <section class="overflow-hidden rounded-2xl bg-white/4" aria-labelledby="portrait-centering-title">
            <SettingToggle
              title={t("settings.faceCentering")}
              description={t("settings.faceCenteringDescription")}
              icon="scan-face"
              pressed={state.faceAutoCenter}
              embedded
              onCheckedChange={setFaceAutoCenter}
            />
            <div class="border-t border-white/7">
              <SettingToggle
                title={t("settings.resumeAfterMovement")}
                description={t("settings.resumeAfterMovementDescription")}
                icon="rotate-ccw"
                pressed={state.resumeFaceAutoCenterAfterViewChange}
                disabled={!state.faceAutoCenter}
                embedded
                onCheckedChange={setResumeFaceAutoCenterAfterViewChange}
              />
            </div>
          </section>
        </div>
        <section class="grid gap-1.5 pt-2" aria-labelledby="more-settings-title">
          <h3 id="more-settings-title" class="px-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/42">
            {t("settings.more")}
          </h3>
          <div class="overflow-hidden rounded-2xl bg-white/4">
            <div class="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
              <span class="grid h-8 w-8 place-items-center rounded-xl bg-white/8 text-white/78">
                <Icon name="translate" class="h-4 w-4" />
              </span>
              <span class="min-w-0">
                <span class="block truncate text-xs font-semibold text-white/92">{t("language.title")}</span>
                <span class="mt-0.5 block truncate text-[11px] leading-snug text-white/48">{t("language.description")}</span>
              </span>
              <LanguagePicker />
            </div>
            <div aria-labelledby="about-title">
              <div class="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 border-t border-white/7 px-3 py-3">
                <FsvrLogo class="h-10 w-10" />
                <div class="relative min-w-0 pr-20">
                  <h3 id="about-title" class="truncate text-xs font-semibold text-white/94">Foursmith VR</h3>
                  <p class="mt-1 text-[11px] leading-snug text-white/48">{t("common.tagline")}</p>
                  <div class="absolute right-0 top-1/2 flex -translate-y-1/2 flex-col items-end gap-0.5">
                    <a
                      href={APP_VERSION_URL}
                      target="_blank"
                      rel="noreferrer"
                      title={t("settings.viewVersion", APP_VERSION)}
                      class="flex h-3.5 items-center rounded-[3px] bg-[#34383c] px-1.5 font-mono text-[8px] leading-none text-white/68 outline-none transition-colors hover:bg-[#41464b] hover:text-white/86 focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      {APP_VERSION}
                    </a>
                    <a
                      href={`${appPackage.homepage}/stargazers`}
                      target="_blank"
                      rel="noreferrer"
                      title={t("settings.viewStars")}
                      class="rounded-[3px] outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      <img
                        src="https://img.shields.io/github/stars/foursmith/vr?style=flat&logo=github&logoColor=white&label=stars&labelColor=26292c&color=34383c"
                        alt={t("settings.githubStars")}
                        class="block h-3.5"
                        loading="lazy"
                      />
                    </a>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2 border-t border-white/7 px-3 py-2.5 text-[10px] leading-0">
                <div class="flex min-w-0 items-center gap-2 text-white/42">
                  <span class="whitespace-nowrap">
                    {t("settings.by")}
                    {" "}
                    <a class="font-medium text-white/68 transition-colors hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:underline" href="https://github.com/ourongxing" target="_blank" rel="noreferrer">ourongxing</a>
                  </span>
                  <span aria-hidden="true" class="h-0.5 w-0.5 shrink-0 rounded-full bg-white/24"></span>
                  <a class="whitespace-nowrap transition-colors hover:text-white/72 focus-visible:text-white/72 focus-visible:outline-none focus-visible:underline" href="https://github.com/foursmith/vr/blob/main/LICENSE" target="_blank" rel="noreferrer">{appPackage.license.replace("-", " ")}</a>
                </div>
                <div class="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-pressed={debug.panelOpen() ? "true" : "false"}
                    title={debug.panelOpen() ? t("settings.hideDebug") : t("settings.showDebug")}
                    class={[ABOUT_ACTION_CLASS, debug.panelOpen() ? "border-accent/18 bg-accent/10 text-accent/82 hover:border-accent/28 hover:bg-accent/15 hover:text-accent" : ABOUT_ACTION_IDLE_CLASS]}
                    onClick={() => debug.setPanelOpen(!debug.panelOpen())}
                  >
                    <Icon name="bug" class="h-3.5 w-3.5" />
                    {t("settings.debug")}
                  </button>
                  <a class={[ABOUT_ACTION_CLASS, ABOUT_ACTION_IDLE_CLASS]} href="https://github.com/foursmith/vr" target="_blank" rel="noreferrer">
                    <Icon name="github" class="h-3.5 w-3.5" />
                    GitHub
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )

  return (
    <Show
      when={narrowScreen()}
      fallback={(
        <Modal
          open={props.open}
          mount={frame.getPlayer()}
          titleId="settings-title"
          descriptionId="settings-description"
          onOpenChange={props.onOpenChange}
        >
          {content()}
        </Modal>
      )}
    >
      <Drawer
        open={props.open}
        mount={frame.getPlayer()}
        titleId="settings-title"
        descriptionId="settings-description"
        onOpenChange={props.onOpenChange}
      >
        {content()}
      </Drawer>
    </Show>
  )
}
