#!/usr/bin/env bun
import type { MediaSource } from "./source"
import { randomBytes } from "node:crypto"
import { networkInterfaces } from "node:os"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { discoverDlnaSources } from "./dlna"
import { createLocalSource } from "./local-source"
import { createMediaServer } from "./server"
import { webAssets } from "./web-assets.generated"

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    "host": { type: "string", default: "127.0.0.1" },
    "port": { type: "string", default: "4190" },
    "root": { type: "string", default: process.cwd() },
    "token": { type: "string" },
    "origin": { type: "string", multiple: true, default: ["https://vr.foursmith.com", "http://localhost:5173"] },
    "dlna-scan": { type: "boolean", default: false },
    "no-open": { type: "boolean", default: false },
  },
})

if (positionals[0] && positionals[0] !== "serve") {
  console.error("Usage: fsvr serve [--root <directory>] [--host <address>] [--port <port>] [--token <token>] [--dlna-scan]")
  process.exit(1)
}

const port = Number(values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be between 1 and 65535")

const token = values.token || randomBytes(24).toString("base64url")
if (!token.trim()) throw new Error("token must not be empty")
const source = await createLocalSource(resolve(values.root!))
const sources = new Map<string, MediaSource>([[source.id, source]])
if (values["dlna-scan"]) {
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
  hostname: values.host!,
  port,
  token,
  sources,
  discoverDlna: discoverDlnaSources,
  allowedOrigins: values.origin!,
  webAssets,
})

const localUrl = `http://127.0.0.1:${server.port}`
const authenticatedLocalUrl = new URL(localUrl)
authenticatedLocalUrl.searchParams.set("token", token)
console.log(`Local server: ${localUrl}`)
console.log(`Media root:   ${source.name}`)
console.log(`Access token: ${token}`)
console.log(`Web UI:       ${localUrl}`)

if (values.host === "0.0.0.0") {
  const lanAddresses = Object.values(networkInterfaces())
    .flat()
    .filter(address => address?.family === "IPv4" && !address.internal)
    .map(address => `http://${address!.address}:${server.port}`)
  for (const address of lanAddresses) {
    console.log(`LAN server:   ${address}`)
  }
}

const shutdown = async () => {
  await server.stop()
  process.exit(0)
}
process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)

if (!values["no-open"]) {
  const command = process.platform === "darwin"
    ? ["open", authenticatedLocalUrl.href]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", authenticatedLocalUrl.href]
      : ["xdg-open", authenticatedLocalUrl.href]
  void Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).exited
}
