import { describe, expect, test } from "bun:test"
import { parseArgs } from "citty"
import { hostnameForHostFlag, mainArgs } from "../src/command"

describe("fsvr command", () => {
  test("listens locally unless --host is specified", () => {
    const localArgs = parseArgs<typeof mainArgs>([], mainArgs)
    const exposedArgs = parseArgs<typeof mainArgs>(["--host"], mainArgs)

    expect(hostnameForHostFlag(localArgs.host)).toBe("127.0.0.1")
    expect(hostnameForHostFlag(exposedArgs.host)).toBe("0.0.0.0")
  })
})
