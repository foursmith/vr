import { relative, resolve, sep } from "node:path"

const root = resolve(import.meta.dir, "../..")
const build = Bun.spawn(["bun", "run", "build", "--", "--mode", "fsvr"], { cwd: root, stdout: "inherit", stderr: "inherit" })
if (await build.exited) throw new Error("Web build failed")

const dist = resolve(root, "dist")
const files = [...new Bun.Glob("**/*").scanSync({ cwd: dist, onlyFiles: true })].sort()
const imports = files.map((file, index) => `import asset${index} from ${JSON.stringify(`../../dist/${file.split(sep).join("/")}`)} with { type: "file" }`)
const entries = files.map((file, index) => `  ${JSON.stringify(`/${file.split(sep).join("/")}`)}: asset${index},`)
const output = `// @ts-nocheck -- generated file imports arbitrary Vite output as embedded Bun assets.\n${imports.join("\n")}\n\nexport const webAssets: Record<string, string> = {\n${entries.join("\n")}\n}\n`
await Bun.write(resolve(root, "cli/src/web-assets.generated.ts"), output)
console.log(`Embedded web manifest: ${files.length} files (${relative(root, dist)})`)
