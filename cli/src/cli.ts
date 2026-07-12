#!/usr/bin/env bun
import { defineCommand, runMain } from "citty"
import { serveCommand } from "./commands/serve"

const main = defineCommand({
  meta: {
    name: "fsvr",
    version: "0.1.0",
    description: "Serve local VR media with the Foursmith VR Web UI",
  },
  default: "serve",
  subCommands: {
    serve: serveCommand,
  },
})

await runMain(main)
