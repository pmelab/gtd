// ESM hooks filling the two gaps native Node (which strips TS types itself)
// leaves vs. tsdown: resolving `./Foo.js` specifiers to on-disk `./Foo.ts`,
// and loading `*.yaml` files as their raw text default export.
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { fileURLToPath, URL } from "node:url"

// fallow-ignore-next-line complexity
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {
    const tsUrl = new URL(specifier.slice(0, -3) + ".ts", context.parentURL)
    if (existsSync(fileURLToPath(tsUrl))) {
      // Omit `format` so Node detects `.ts` and strips types itself.
      return { url: tsUrl.href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".yaml")) {
    const source = await readFile(new URL(url), "utf8")
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)}`,
    }
  }
  return nextLoad(url, context)
}
