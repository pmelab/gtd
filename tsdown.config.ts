import { defineConfig, type UserConfig } from "tsdown"

const NODE_BANNER = `#!/usr/bin/env node
import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);`

// A pinned process carries no ui or lsp: loading either fails, and the
// command that loaded it fails with this message as a GtdError.
const PINNED_STUB = "\0gtd-core-stub"
const withoutUiAndLsp = {
  name: "gtd-core-stubs",
  async resolveId(
    this: { resolve: (source: string, importer?: string) => Promise<{ id: string } | null> },
    source: string,
    importer: string | undefined,
  ) {
    if (!/(^|\/)(ui|lsp)\/index\.js$/.test(source)) return null
    const resolved = await this.resolve(source, importer)
    return resolved && /[\\/]src[\\/](ui|lsp)[\\/]index\.ts$/.test(resolved.id) ? PINNED_STUB : null
  },
  load(id: string) {
    return id === PINNED_STUB ? 'throw new Error("not available in a pinned process")' : null
  },
}

const gtdBinary = {
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  outExtensions: () => ({ js: ".mjs" }),
  banner: { js: NODE_BANNER },
  deps: { alwaysBundle: [/.*/] },
  dts: false,
  outputOptions: { codeSplitting: false },
} satisfies UserConfig

// Browser-first: the phone/web client bundles for the browser platform, then
// `scripts/inline-web-client.mjs` folds its output into
// src/ui/client.generated.html (gitignored), which the `gtd` config imports
// through the ".html" text loader. tsdown builds array entries in PARALLEL
// (see its `buildWithConfigs`), so this ordering is not self-enforcing —
// `npm run build`'s script runs `tsdown --filter web`, the inline step, then
// `gtd` and `core` together, then `entrypoints`, using each config's `name` to
// select it.
export default defineConfig([
  {
    name: "web",
    entry: { main: "src/web/main.tsx" },
    format: ["esm"],
    platform: "browser",
    target: "esnext",
    outDir: "dist/web",
    clean: true,
    dts: false,
    // Inlined as ONE `<script type="module">` with no `<script src>`/import
    // map (see scripts/inline-web-client.mjs) — a bare `import … from
    // "react"` left external has nothing to resolve against in a browser.
    // Bundle every dependency (react, @trpc/*, @tanstack/react-query, …), no
    // exceptions, mirroring the `gtd` config's own `deps.alwaysBundle` below.
    deps: { alwaysBundle: [/.*/] },
    outputOptions: { codeSplitting: false },
    // Lets `writeStore.ts`'s dev-only `console.warn` (an absent `mutate`)
    // fold away as dead code in the shipped bundle — unlike Vite, tsdown's
    // browser platform leaves `process.env.NODE_ENV` unreplaced by default,
    // so without this the literal check survives into `dist/web/`.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  },
  {
    ...gtdBinary,
    name: "gtd",
    entry: { "gtd.bundle": "src/main.ts" },
    loader: { ".html": "text" },
    // Only its own file: `tsdown --watch` builds every config in parallel,
    // and cleaning all of dist/ would race the `entrypoints` build.
    clean: ["dist/gtd.bundle.mjs"],
  },
  {
    // The engine a pin carries: judges stay, since verdicts decide the path.
    ...gtdBinary,
    name: "core",
    entry: { "gtd.core": "src/main.ts" },
    plugins: [withoutUiAndLsp],
    minify: true,
    clean: ["dist/gtd.core.mjs"],
  },
  {
    // Every other package subpath. One build so the entries share chunks;
    // `tests/tooling/entrypoints.test.ts` pins what each entry may contain.
    name: "entrypoints",
    entry: {
      flows: "src/flows/index.ts",
      wire: "src/wire/index.ts",
      steering: "src/steering/index.ts",
      "workflow-kit": "src/workflow-kit/index.ts",
      testkit: "src/testkit/index.ts",
      "testkit/gherkin": "src/gherkin/index.ts",
    },
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    outExtensions: () => ({ js: ".mjs" }),
    clean: ["dist/chunks", "dist/testkit", "dist/{flows,wire,steering,workflow-kit,testkit}.mjs"],
    // The test runner the gherkin steps run inside is the consumer's own: its
    // optional peers stay imports.
    deps: { alwaysBundle: (id) => !/^(vitest|quickpickle|@vitest\/)/.test(id) },
    dts: false,
    outputOptions: { chunkFileNames: "chunks/[name]-[hash].mjs" },
  },
])
