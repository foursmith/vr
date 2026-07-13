import { resolve } from "node:path"

const cliRoot = resolve(import.meta.dir, "..")
const prepare = Bun.spawn(["bun", "run", "prepare:web"], { cwd: cliRoot, stdout: "inherit", stderr: "inherit" })
if (await prepare.exited) throw new Error("Web asset preparation failed")

const result = await Bun.build({
  entrypoints: [resolve(cliRoot, "src/cli.ts")],
  compile: { outfile: resolve(cliRoot, "dist/fsvr") },
  minify: true,
})
if (!result.success) throw new AggregateError(result.logs, "fsvr build failed")
