import { describe, expect, it } from "vitest"
import { localFsvrVideoLocation } from "./location"

const encodeBase64Url = (value: string) => btoa(value)
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/, "")

describe("localFsvrVideoLocation", () => {
  it("decodes local FSVR locations into expandable folder IDs", () => {
    const location = localFsvrVideoLocation(encodeBase64Url("Movies/Trips/clip.mp4"))
    expect(location).toEqual({
      folderIds: [
        "source:local",
        `local:${encodeBase64Url("Movies")}`,
        `local:${encodeBase64Url("Movies/Trips")}`,
      ],
      name: "clip.mp4",
    })
  })
})
