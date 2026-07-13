import type { MediaSource } from "../src/source"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { createLocalSource } from "../src/local-source"
import { createMediaServer } from "../src/server"

const servers: ReturnType<typeof createMediaServer>[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.stop()))
})

describe("fsvr media server", () => {
  test("lists media and serves authenticated byte ranges", async () => {
    const root = await mkdtemp(join(tmpdir(), "fsvr-"))
    await mkdir(join(root, "Movies"))
    await writeFile(join(root, "Movies", "sample.mp4"), "0123456789")
    await writeFile(join(root, "ignore.txt"), "hidden")
    await writeFile(join(root, "index.html"), "<html>fsvr</html>")
    const source = await createLocalSource(root)
    const dlnaSource: MediaSource = {
      id: "dlna-test",
      name: "Test DLNA",
      kind: "dlna",
      list: async () => [],
      resolve: async () => ({ kind: "url", url: "http://192.0.2.1/video.mp4" }),
    }
    const server = createMediaServer({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      sources: new Map([[source.id, source]]),
      discoverDlna: async () => [dlnaSource],
      webAssets: { "/index.html": join(root, "index.html") },
    })
    servers.push(server)
    const base = `http://${server.hostname}:${server.port}`

    expect((await fetch(`${base}/api/v1/sources`)).status).toBe(401)
    expect((await fetch(`${base}/api/v1/status`)).status).toBe(200)
    const webResponse = await fetch(`${base}/`)
    expect(await webResponse.text()).toBe("<html>fsvr</html>")
    expect(webResponse.headers.get("set-cookie")).toBeNull()
    expect(await fetch(`${base}/api/v1/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    }).then(response => response.status)).toBe(401)
    const authResponse = await fetch(`${base}/api/v1/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "secret" }),
    })
    expect(authResponse.status).toBe(200)
    const authCookieHeader = authResponse.headers.get("set-cookie")!
    expect(authCookieHeader).toContain("HttpOnly")
    expect(authCookieHeader).toContain("Secure")
    expect(authCookieHeader).toContain("SameSite=Strict")
    expect(authCookieHeader).toContain("Path=/")
    const authCookie = authCookieHeader.split(";", 1)[0]
    expect(authCookie).toBe("fsvr_password=secret")
    expect(await fetch(`${base}/api/v1/auth`, { headers: { cookie: authCookie } }).then(response => response.json()))
      .toEqual({ authenticated: true })
    expect((await fetch(`${base}/api/v1/sources`, { headers: { cookie: authCookie } })).status).toBe(200)
    const rejectedReplacement = await fetch(`${base}/api/v1/auth`, {
      method: "POST",
      headers: { "content-type": "application/json", "cookie": authCookie },
      body: JSON.stringify({ password: "wrong" }),
    })
    expect(rejectedReplacement.status).toBe(401)
    expect(rejectedReplacement.headers.get("set-cookie")).toBe("fsvr_password=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0")
    const replacementAuth = await fetch(`${base}/api/v1/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "secret" }),
    })
    const replacementCookie = replacementAuth.headers.get("set-cookie")!.split(";", 1)[0]
    expect((await fetch(`${base}/api/v1/sources`, {
      headers: { authorization: "Bearer secret" },
    })).status).toBe(401)
    const rootEntries = await fetch(`${base}/api/v1/sources/local/entries`, {
      headers: { cookie: replacementCookie },
    }).then(response => response.json()) as Array<{ id: string, kind: string, name: string }>
    expect(rootEntries.map(entry => entry.name)).toEqual(["Movies"])

    const children = await fetch(`${base}/api/v1/sources/local/entries?path=${rootEntries[0].id}`, {
      headers: { cookie: replacementCookie },
    }).then(response => response.json()) as Array<{ id: string, kind: string, name: string }>
    expect(children.map(entry => entry.name)).toEqual(["sample.mp4"])

    expect((await fetch(`${base}/api/v1/media/local/${children[0].id}?password=secret`)).status).toBe(401)
    const response = await fetch(`${base}/api/v1/media/local/${children[0].id}`, {
      headers: { range: "bytes=2-5", origin: "https://vr.foursmith.com", cookie: replacementCookie },
    })
    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10")
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    expect(await response.text()).toBe("2345")

    const crossOriginResponse = await fetch(`${base}/api/v1/status`, {
      headers: { cookie: replacementCookie, origin: "http://localhost:2333" },
    })
    expect(crossOriginResponse.headers.get("access-control-allow-origin")).toBeNull()

    const discovered = await fetch(`${base}/api/v1/dlna/discover`, {
      method: "POST",
      headers: { cookie: replacementCookie },
    }).then(response => response.json()) as Array<{ id: string, kind: string, name: string }>
    expect(discovered).toEqual([{ id: "dlna-test", kind: "dlna", name: "Test DLNA" }])
    const sources = await fetch(`${base}/api/v1/sources`, {
      headers: { cookie: replacementCookie },
    }).then(response => response.json()) as Array<{ id: string }>
    expect(sources.map(item => item.id)).toEqual(["local", "dlna-test"])

    const logoutResponse = await fetch(`${base}/api/v1/auth`, { method: "DELETE", headers: { cookie: replacementCookie } })
    expect(logoutResponse.status).toBe(200)
    expect(logoutResponse.headers.get("set-cookie")).toBe("fsvr_password=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0")
  })
})
