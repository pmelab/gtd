// Dev-only ESM hooks so `node` can run the TypeScript sources directly:
//   - resolve relative `./Foo.js` specifiers to the on-disk `./Foo.ts`
//     (the build uses `allowImportingTsExtensions`; native Node does not)
//   - import `*.md` files as their raw text default export, mirroring tsdown's
//     `loader: { ".md": "text" }`
// Node strips the TypeScript types natively; these hooks only fill the two
// gaps tsdown would otherwise cover.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

// fallow-ignore-next-line complexity
export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    specifier.endsWith(".js")
  ) {
    const tsUrl = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
    if (existsSync(fileURLToPath(tsUrl))) {
      // Omit `format` so Node detects the `.ts` extension and strips types.
      return { url: tsUrl.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".md")) {
    const source = await readFile(new URL(url), "utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)}`,
    };
  }
  return nextLoad(url, context);
}
