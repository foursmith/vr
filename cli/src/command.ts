import type { MediaSource } from "./source"
import { randomBytes } from "node:crypto"
import { networkInterfaces } from "node:os"
import { resolve } from "node:path"
import { defineCommand } from "citty"
import { discoverDlnaSources } from "./dlna"
import { createLocalSource } from "./local-source"
import { createMediaServer } from "./server"

const webAssets = process.env.FSVR_WEB_URL
  ? undefined
  : (await import("./web-assets.generated")).webAssets

export const mainArgs = {
  "directory": { type: "positional", description: "Media directory", required: false, default: process.cwd() },
  "host": { type: "boolean", description: "Listen on all network interfaces", default: false },
  "port": { type: "string", description: "Port to listen on", valueHint: "port", default: "4090" },
  "password": { type: "string", description: "Stable access password", valueHint: "password" },
  "dlna-scan": { type: "boolean", description: "Scan for DLNA servers before startup", default: false },
  "open": { type: "boolean", description: "Open the Web UI", default: false },
} as const

export const hostnameForHostFlag = (host: boolean) => host ? "0.0.0.0" : "127.0.0.1"

const WEB_UI_OPENED = Symbol.for("fsvr.web-ui-opened")

export const claimWebUiOpen = (state: object = globalThis) => {
  const hotReloadState = state as Record<PropertyKey, unknown>
  if (hotReloadState[WEB_UI_OPENED]) return false
  hotReloadState[WEB_UI_OPENED] = true
  return true
}

export const mainCommand = defineCommand({
  meta: {
    name: "fsvr",
    version: "0.1.0",
    description: "Serve local VR media with the Foursmith VR Web UI",
  },
  args: mainArgs,
  async run({ args }) {
    const port = Number(args.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be between 1 and 65535")

    const password = args.password ?? randomBytes(24).toString("base64url")
    if (!password.trim()) throw new Error("password must not be empty")

    const source = await createLocalSource(resolve(args.directory))
    const sources = new Map<string, MediaSource>([[source.id, source]])
    if (args["dlna-scan"]) {
      console.log("Scanning DLNA media servers…")
      try {
        const dlnaSources = await discoverDlnaSources()
        dlnaSources.forEach(dlnaSource => sources.set(dlnaSource.id, dlnaSource))
        console.log(`DLNA devices: ${dlnaSources.length}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error"
        console.warn(`DLNA scan failed: ${message}`)
      }
    }

    const server = createMediaServer({
      hostname: hostnameForHostFlag(args.host),
      port,
      password,
      sources,
      discoverDlna: discoverDlnaSources,
      webAssets,
    })

    const localUrl = `http://127.0.0.1:${server.port}`
    const webUrl = process.env.FSVR_WEB_URL ?? localUrl
    const authenticatedLocalUrl = new URL(webUrl)
    authenticatedLocalUrl.searchParams.set("password", password)
    console.log(`Local server: ${localUrl}`)
    console.log(`Media root:   ${source.name}`)
    console.log(`Password:     ${password}`)
    console.log(`Web UI:       ${webUrl}`)

    if (args.host) {
      const lanAddresses = Object.values(networkInterfaces())
        .flat()
        .filter(address => address?.family === "IPv4" && !address.internal)
        .map(address => `http://${address!.address}:${server.port}`)
      for (const address of lanAddresses) console.log(`LAN server:   ${address}`)
    }

    const shutdown = async () => {
      await server.stop()
      process.exit(0)
    }
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)

    if (args.open && claimWebUiOpen()) {
      const command = process.platform === "darwin"
        ? ["open", authenticatedLocalUrl.href]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", authenticatedLocalUrl.href]
          : ["xdg-open", authenticatedLocalUrl.href]
      void Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).exited
    }
  },
})
