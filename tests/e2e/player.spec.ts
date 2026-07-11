import { Buffer } from "node:buffer"
import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"

const blockModels = async (page: import("@playwright/test").Page) => {
  await page.route("**/models/**", route => route.abort())
}

test("shows the empty player and exposes its primary controls", async ({ page }) => {
  await blockModels(page)
  await page.goto("/")
  await expect(page.getByText("Drop video files or folders here").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Choose files" }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Playlist" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible()
  await expect(page.locator("#video")).toHaveAttribute("playsinline", "")
})

test("imports multiple videos, opens the playlist, selects and clears it", async ({ page }) => {
  await blockModels(page)
  await page.goto("/")
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles([
    { name: "clip10.mp4", mimeType: "video/mp4", buffer: Buffer.from("first") },
    { name: "clip2.webm", mimeType: "video/webm", buffer: Buffer.from("second") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("ignored") },
  ])

  const playlist = page.getByRole("complementary", { name: "Playlist" })
  await expect(playlist).toBeVisible()
  await expect(playlist.getByText("2 videos")).toBeVisible()
  await expect(playlist.getByRole("button", { name: "Choose files" })).toBeVisible()
  await expect(playlist.getByRole("button", { name: "Choose folder" })).toBeVisible()
  const populatedPlaylistBox = await playlist.boundingBox()
  const treeItems = playlist.getByRole("treeitem")
  await expect(treeItems).toHaveCount(2)
  await expect(treeItems.nth(0)).toContainText("clip2.webm")
  await expect(treeItems.nth(1)).toContainText("clip10.mp4")

  await playlist.getByRole("button", { name: "Clear playlist" }).click()
  await expect(playlist.getByText("0 videos")).toBeVisible()
  await expect(playlist.getByText("Drop video files or folders here")).toHaveCount(0)
  await expect(playlist.getByRole("button", { name: "Choose files" })).toHaveCount(0)
  await expect(playlist.getByRole("button", { name: "Choose folder" })).toHaveCount(0)
  const emptyPlaylistBox = await playlist.boundingBox()
  expect(populatedPlaylistBox).not.toBeNull()
  expect(emptyPlaylistBox).not.toBeNull()
  expect(emptyPlaylistBox!.height).toBeLessThan(populatedPlaylistBox!.height)
})

test("plays and pauses a real video through the application controls", async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto("/")
  await expect(page.getByRole("slider", { name: "Playback position" })).toBeEnabled({ timeout: 30_000 })
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles("tests/fixtures/sample.mp4")

  const video = page.locator("#video")
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(1)
  const metadata = await video.evaluate((element: HTMLVideoElement) => ({
    duration: element.duration,
    width: element.videoWidth,
    height: element.videoHeight,
  }))
  expect(metadata.duration).toBeCloseTo(2, 1)
  expect(metadata).toMatchObject({ width: 160, height: 90 })

  const pause = page.getByRole("button", { name: "Pause", exact: true })
  await expect(pause).toBeVisible()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.2)
  await pause.click()
  await expect(video).toHaveJSProperty("paused", true)
  const pausedAt = await video.evaluate((element: HTMLVideoElement) => element.currentTime)
  await page.waitForTimeout(150)
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(pausedAt, 1)

  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect(video).toHaveJSProperty("paused", false)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(pausedAt + 0.1)
})

test("detects a face with the real MediaPipe backend", async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto("/")
  const fixtures = [
    "face-down-profile.jpg",
    "face-down-close.jpg",
    "face-front-wide.jpg",
    "face-down-obscured.jpg",
  ].map(name => ({ name, base64: readFileSync(`tests/fixtures/${name}`).toString("base64") }))

  const detection = await page.evaluate(async (images) => {
    const { FaceTrackerClient } = await import("/src/features/face-tracking/client.ts")
    const client = new FaceTrackerClient()
    try {
      await client.initialize(() => {})
      const results = []
      for (const image of images) {
        const bytes = Uint8Array.from(atob(image.base64), character => character.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }))
        const result = await client.infer("detection", bitmap, performance.now())
        results.push({ name: image.name, faces: result.faces })
      }
      return { backend: client.getBackendLabel(), results }
    } finally {
      client.destroy()
    }
  }, fixtures)

  expect(detection.backend).toMatch(/Worker CPU|Main thread fallback/)
  for (const result of detection.results) {
    expect(result.faces.length, `${result.name} should contain a detectable face`).toBeGreaterThanOrEqual(1)
    expect(result.faces[0]).toMatchObject({
      score: expect.any(Number),
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    })
    expect(result.faces[0].score, `${result.name} detection confidence`).toBeGreaterThanOrEqual(0.5)
  }
})

test("toggles player display settings and playlist visibility", async ({ page }) => {
  await blockModels(page)
  await page.goto("/")

  await page.getByRole("button", { name: "Settings" }).click()
  const settings = page.getByRole("dialog", { name: "Settings" })
  await expect(settings.getByText("Video only")).toHaveCount(0)
  const split = settings.getByRole("switch", { name: /Fill wide screens/ })
  await expect(split).toHaveAttribute("aria-checked", "true")
  await split.click()
  await expect(split).toHaveAttribute("aria-checked", "false")
  await settings.getByRole("button", { name: "Close settings" }).click()

  await page.getByRole("button", { name: "Playlist" }).click()
  await expect(page.getByRole("complementary", { name: "Playlist" })).toBeVisible()
  await page.getByRole("button", { name: "Close playlist" }).click()
  const hiddenPlaylist = page.locator("div[aria-hidden]").filter({ has: page.locator("aside[aria-label=\"Playlist\"]") })
  await expect(hiddenPlaylist).toHaveAttribute("aria-hidden", "true")
})

test("keeps the playlist above the control bar without resizing the controls", async ({ page }) => {
  await blockModels(page)
  await page.goto("/")

  const controls = page.locator("#player > aside")
  const closedControlsBox = await controls.boundingBox()
  await page.getByRole("button", { name: "Playlist" }).click()

  const playlist = page.getByRole("complementary", { name: "Playlist" })
  const [playlistBox, openControlsBox] = await Promise.all([
    playlist.boundingBox(),
    controls.boundingBox(),
  ])

  expect(closedControlsBox).not.toBeNull()
  expect(playlistBox).not.toBeNull()
  expect(openControlsBox).not.toBeNull()
  expect(openControlsBox!.width).toBeCloseTo(closedControlsBox!.width, 0)
  expect(playlistBox!.y + playlistBox!.height).toBeLessThanOrEqual(openControlsBox!.y)
})

test("renders the unsupported-browser message for Firefox-like clients", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgentData", { value: undefined })
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 Firefox/128.0" })
  })
  await page.goto("/")
  await expect(page.getByText("Unsupported browser")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Switch to a Chromium browser" })).toBeVisible()
})
