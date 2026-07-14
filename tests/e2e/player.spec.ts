import { Buffer } from "node:buffer"
import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"

const blockModels = async (page: import("@playwright/test").Page) => {
  await page.route("**/models/**", route => route.abort())
}

test("imports and clears multiple videos", async ({ page }) => {
  await blockModels(page)
  await page.goto("/")

  await expect(page.getByRole("button", { name: "Choose files" }).first()).toBeVisible()
  await expect(page.locator(".player-controls")).toHaveCount(0)

  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles([
    { name: "clip10.mp4", mimeType: "video/mp4", buffer: Buffer.from("first") },
    { name: "clip2.webm", mimeType: "video/webm", buffer: Buffer.from("second") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("ignored") },
  ])

  await expect(page.locator(".player-controls")).toBeVisible()

  const playlist = page.getByRole("complementary", { name: "Playlist" })
  await expect(playlist).toBeVisible()
  await expect(playlist.getByText("2 videos")).toBeVisible()
  await expect(playlist.getByRole("treeitem")).toHaveCount(2)

  await playlist.getByRole("button", { name: "Clear playlist" }).click()
  await expect(playlist.getByText("0 videos")).toBeVisible()
})

test("plays and pauses a real video through the application controls", async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto("/")
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles("tests/fixtures/sample.mp4")
  await expect(page.getByRole("slider", { name: "Playback position" })).toBeEnabled({ timeout: 30_000 })

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
