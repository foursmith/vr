import { resolve } from "node:path"

const cliRoot = resolve(import.meta.dir, "..")
const root = resolve(cliRoot, "..")
const args = process.argv.slice(2)
const portIndex = args.indexOf("--port")
const apiPort = args.find(argument => argument.startsWith("--port="))?.slice("--port=".length)
  ?? (portIndex >= 0 ? args[portIndex + 1] : undefined)

const web = Bun.spawn(["bun", "run", "vite", "--mode", "fsvr-dev"], {
  cwd: root,
  env: {
    ...process.env,
    FSVR_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

const cli = Bun.spawn([
  "bun",
  "--hot",
  "--no-clear-screen",
  "run",
  "src/cli.ts",
  ...args,
], {
  cwd: cliRoot,
  env: {
    ...process.env,
    FSVR_WEB_URL: "http://127.0.0.1:4090",
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

const exitCode = await Promise.race([web.exited, cli.exited])
web.kill()
cli.kill()
process.exit(exitCode)
