import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

const compileTargets = [
  "bun-linux-x64-baseline",
  "bun-linux-x64-baseline-musl",
  "bun-linux-arm64",
  "bun-linux-arm64-musl",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64-baseline",
] as const satisfies readonly Bun.Build.CompileTarget[]

const option = (name: string) => {
  const prefix = `--${name}=`
  const inline = process.argv.find(argument => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)

  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const requestedTarget = option("target")
if (requestedTarget && !compileTargets.includes(requestedTarget as typeof compileTargets[number])) {
  throw new Error(`Unsupported build target: ${requestedTarget}`)
}

const cliRoot = resolve(import.meta.dir, "..")
const prepare = Bun.spawn(["bun", "run", "prepare:web"], { cwd: cliRoot, stdout: "inherit", stderr: "inherit" })
if (await prepare.exited) throw new Error("Web asset preparation failed")

const outfile = resolve(cliRoot, option("outfile") ?? "dist/fsvr")
mkdirSync(resolve(outfile, ".."), { recursive: true })

const result = await Bun.build({
  entrypoints: [resolve(cliRoot, "src/cli.ts")],
  compile: {
    outfile,
    ...(requestedTarget ? { target: requestedTarget as Bun.Build.CompileTarget } : {}),
  },
  minify: true,
})
if (!result.success) throw new AggregateError(result.logs, "fsvr build failed")
