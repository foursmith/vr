import { describe, expect, test } from "bun:test"
import { parseArgs } from "citty"
import { claimWebUiOpen, hostnameForHostFlag, mainArgs } from "../src/command"

describe("fsvr command", () => {
  test("listens locally unless --host is specified", () => {
    const localArgs = parseArgs<typeof mainArgs>([], mainArgs)
    const exposedArgs = parseArgs<typeof mainArgs>(["--host"], mainArgs)

    expect(hostnameForHostFlag(localArgs.host)).toBe("127.0.0.1")
    expect(hostnameForHostFlag(exposedArgs.host)).toBe("0.0.0.0")
  })

  test("supports explicitly disabling password authentication", () => {
    const args = parseArgs<typeof mainArgs>(["--disable-password"], mainArgs)

    expect(args["disable-password"]).toBe(true)
  })

  test("opens the Web UI only once across hot reloads", () => {
    const hotReloadState = {}

    expect(claimWebUiOpen(hotReloadState)).toBe(true)
    expect(claimWebUiOpen(hotReloadState)).toBe(false)
  })
})
