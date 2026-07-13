import { randomBytes } from "node:crypto"
import { resolve } from "node:path"

const cliRoot = resolve(import.meta.dir, "..")
const root = resolve(cliRoot, "..")
const args = process.argv.slice(2).filter((argument, index) => argument !== "--" || index !== 0)

const readOption = (name: string) => {
  const assignment = args.find(argument => argument.startsWith(`--${name}=`))
  if (assignment) return assignment.slice(name.length + 3)
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : undefined
}

const providedApiPort = readOption("port")
const apiPort = providedApiPort ?? "4191"
const apiHost = readOption("host") ?? "0.0.0.0"
const providedPassword = readOption("password")
const password = providedPassword ?? randomBytes(24).toString("base64url")
const open = args.includes("--open")
const cliArgs = [
  ...args.filter(argument => argument !== "--open"),
  ...(providedApiPort === undefined ? ["--port", apiPort] : []),
  ...(providedPassword === undefined ? ["--password", password] : []),
]
const proxyHostname = apiHost === "0.0.0.0" || apiHost === "::" ? "127.0.0.1" : apiHost
const proxyHost = proxyHostname.includes(":") && !proxyHostname.startsWith("[") ? `[${proxyHostname}]` : proxyHostname
const apiOrigin = `http://${proxyHost}:${apiPort}`
const webUrl = "http://127.0.0.1:4090"

const waitForUrl = async (url: string | URL, subprocess: { exitCode: number | null }, label: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (subprocess.exitCode !== null) throw new Error(`${label} exited with code ${subprocess.exitCode}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await Bun.sleep(100)
  }
  throw new Error(`${label} did not start at ${url}`)
}

const vite = Bun.spawn(["bun", "run", "vite", "--mode", "fsvr-dev"], {
  cwd: root,
  env: {
    ...process.env,
    FSVR_API_ORIGIN: apiOrigin,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

try {
  await waitForUrl(webUrl, vite, "Vite")
} catch (error) {
  vite.kill()
  throw error
}

const cli = Bun.spawn(["bun", "--hot", "--no-clear-screen", "run", "src/cli.ts", ...cliArgs], {
  cwd: cliRoot,
  env: {
    ...process.env,
    FSVR_WEB_URL: webUrl,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

try {
  await waitForUrl(new URL("/api/v1/status", apiOrigin), cli, "CLI server")
} catch (error) {
  cli.kill()
  vite.kill()
  throw error
}

if (open) {
  const authenticatedWebUrl = new URL(webUrl)
  authenticatedWebUrl.searchParams.set("password", password)
  const command = process.platform === "darwin"
    ? ["open", authenticatedWebUrl.href]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", authenticatedWebUrl.href]
      : ["xdg-open", authenticatedWebUrl.href]
  void Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).exited
}

const shutdown = () => {
  cli.kill()
  vite.kill()
}

process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)

const exitCode = await Promise.race([cli.exited, vite.exited])
shutdown()
process.exit(exitCode)
