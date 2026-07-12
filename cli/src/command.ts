import type { MediaSource } from "./source"
import { randomBytes } from "node:crypto"
import { networkInterfaces } from "node:os"
import { resolve } from "node:path"
import { defineCommand } from "citty"
import { discoverDlnaSources } from "./dlna"
import { createLocalSource } from "./local-source"
import { createMediaServer } from "./server"
import { webAssets } from "./web-assets.generated"

const DEFAULT_ORIGINS = ["https://vr.foursmith.com", "http://localhost:5173"]

const readRepeatedOption = (rawArgs: string[], name: string) => {
  const values: string[] = []
  for (let index = 0; index < rawArgs.length; index++) {
    const argument = rawArgs[index]
    if (argument === `--${name}` && rawArgs[index + 1]) values.push(rawArgs[++index])
    else if (argument.startsWith(`--${name}=`)) values.push(argument.slice(name.length + 3))
  }
  return values
}

export const mainCommand = defineCommand({
  meta: {
    name: "fsvr",
    version: "0.1.0",
    description: "Serve local VR media with the Foursmith VR Web UI",
  },
  args: {
    "directory": { type: "positional", description: "Media directory", required: false, default: process.cwd() },
    "host": { type: "string", description: "Address to listen on", valueHint: "address", default: "127.0.0.1" },
    "port": { type: "string", description: "Port to listen on", valueHint: "port", default: "4190" },
    "password": { type: "string", description: "Stable access password", valueHint: "password" },
    "origin": { type: "string", description: "Allowed browser origin (repeatable)", valueHint: "origin" },
    "dlna-scan": { type: "boolean", description: "Scan for DLNA servers before startup", default: false },
    "no-open": { type: "boolean", description: "Do not open the Web UI", default: false },
  },
  async run({ args, rawArgs }) {
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

    const origins = readRepeatedOption(rawArgs, "origin")
    const server = createMediaServer({
      hostname: args.host,
      port,
      password,
      sources,
      discoverDlna: discoverDlnaSources,
      allowedOrigins: origins.length > 0 ? origins : DEFAULT_ORIGINS,
      webAssets,
    })

    const localUrl = `http://127.0.0.1:${server.port}`
    const authenticatedLocalUrl = new URL(localUrl)
    authenticatedLocalUrl.searchParams.set("password", password)
    console.log(`Local server: ${localUrl}`)
    console.log(`Media root:   ${source.name}`)
    console.log(`Password:     ${password}`)
    console.log(`Web UI:       ${localUrl}`)

    if (args.host === "0.0.0.0") {
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

    if (!args["no-open"]) {
      const command = process.platform === "darwin"
        ? ["open", authenticatedLocalUrl.href]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", authenticatedLocalUrl.href]
          : ["xdg-open", authenticatedLocalUrl.href]
      void Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).exited
    }
  },
})
