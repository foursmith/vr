import { describe, expect, it } from "vitest"
import { createMotionPhoto } from "../../src/lib/motion-photo"

describe("motion photo", () => {
  it("injects Motion Photo XMP and appends the video to one JPEG", async () => {
    const coverBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0xAA, 0xBB, 0xFF, 0xD9])
    const cover = new Blob([coverBytes], { type: "image/jpeg" })
    const video = new Blob(["video"], { type: "video/mp4" })

    const result = await createMotionPhoto(cover, video)
    const resultBytes = new Uint8Array(await result.arrayBuffer())
    const text = new TextDecoder().decode(resultBytes)
    const xmpEnd = "<?xpacket end=\"w\"?>"
    const xmp = text.slice(text.indexOf("<?xpacket"), text.indexOf(xmpEnd) + xmpEnd.length)

    expect(result.type).toBe("image/jpeg")
    expect(resultBytes.slice(0, 8)).toEqual(coverBytes.slice(0, 8))
    expect(resultBytes[8]).toBe(0xFF)
    expect(resultBytes[9]).toBe(0xE1)
    expect(text).toContain("GCamera:MotionPhoto=\"1\"")
    expect(text).toContain("xmlns:OpCamera=\"http://ns.oplus.com/photos/1.0/camera/\"")
    expect(text).toContain("xmlns:MiCamera=\"http://ns.xiaomi.com/photos/1.0/camera/\"")
    expect(text).toContain("OpCamera:VideoLength=\"5\"")
    expect(text).toContain("GCamera:MicroVideoOffset=\"5\"")
    expect(text).toContain("Item:Semantic=\"MotionPhoto\"")
    expect(text).toContain("Item:Length=\"5\"")
    expect(new DOMParser().parseFromString(xmp, "application/xml").querySelector("parsererror")).toBeNull()
    expect(new TextDecoder().decode(resultBytes.slice(-5))).toBe("video")
  })

  it("rejects a non-JPEG Motion Photo cover", async () => {
    await expect(createMotionPhoto(new Blob(["not jpeg"]), new Blob(["video"]))).rejects.toThrow("not a valid JPEG")
  })
})
