import { flush } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { projectionLabel, setLocale, t } from "./i18n"

afterEach(() => {
  setLocale("en")
  flush()
})

describe("translations", () => {
  it("switches static and contextual translations reactively", () => {
    setLocale("zh-CN")
    flush()
    expect(t("media.chooseFiles")).toBe("选择文件")
    expect(t("playlist.playbackMode", t("playlist.repeatVideo"))).toBe("播放模式：单曲循环")

    setLocale("ja")
    flush()
    expect(t("media.chooseFolder")).toBe("フォルダーを選択")
    expect(projectionLabel("flat_2d")).toBe("通常の2D映像")
  })
})
