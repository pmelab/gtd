import { readFileSync } from "node:fs"
import ts from "typescript"
import { defineConfig } from "vite-plus"
import type { PackUserConfig } from "vite-plus/pack"
import { TASKS, VITEST_TASKS } from "./scripts/test-states.ts"

// Inputs are auto-tracked; only what auto-tracking cannot see (env, build
// outputs) is declared.
// Auto-tracking records directory listings and ignores .gitignore: without
// these, build's own writes invalidate every task that walks the tree.
const input = [
  { auto: true },
  "!dist/**",
  "!src/ui/client.generated.html",
  // Vitest's results cache and vp's own task cache: rewritten by every run.
  "!node_modules/.vite/**",
]
const check = { input, untrackedEnv: ["TMPDIR", "TERM"], output: [] }
const flagged = { ...check, env: ["GTD_FLAG_*"] }

// The oxc configs, read in place so the standalone tools keep working. vp runs
// the oxfmt/oxlint package.json pins: oxfmt 0.74 (vp's own) panics on an empty
// footnote definition, which tests/tooling/steering-oxfmt.test.ts catches.
const json = (path: string) => {
  const text = readFileSync(new URL(path, import.meta.url), "utf8")
  const { $schema: _, ...rest } = ts.parseConfigFileTextToJson(path, text).config
  return rest
}

// Type-aware: claude/ and .storybook/ sit outside every tsconfig, as for tsc;
// gtd.config.ts imports a workflow checkout only the maintainer's machine has.
const lintConfig = ({ ignorePatterns, ...rest }: { ignorePatterns: string[] }) => ({
  ...rest,
  ignorePatterns: [...ignorePatterns, "claude", ".storybook", "gtd.config.ts"],
  options: { typeAware: true, typeCheck: true },
})

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
} satisfies PackUserConfig

// Browser-first: the phone/web client bundles for the browser platform, then
// `scripts/inline-web-client.mjs` folds its output into
// src/ui/client.generated.html (gitignored), which the `gtd` config imports
// through the ".html" text loader. pack builds array entries in PARALLEL
// (see tsdown's `buildWithConfigs`), so this ordering is not self-enforcing —
// scripts/build.mjs runs `vp pack --filter web`, the inline step, then
// `gtd` and `core` together, then `entrypoints`, using each config's `name` to
// select it.
const pack: PackUserConfig[] = [
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
    // fold away as dead code in the shipped bundle — unlike Vite, pack's
    // browser platform leaves `process.env.NODE_ENV` unreplaced by default,
    // so without this the literal check survives into `dist/web/`.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  },
  {
    ...gtdBinary,
    name: "gtd",
    entry: { "gtd.bundle": "src/main.ts" },
    loader: { ".html": "text" },
    // Only its own file: `vp pack --watch` builds every config in parallel,
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
]

export default defineConfig({
  pack,
  fmt: json("./.oxfmtrc.json"),
  staged: { "*": "vp fmt --no-error-on-unmatched-pattern" },
  lint: lintConfig(json("./.oxlintrc.json")),
  run: {
    tasks: {
      build: {
        command: "node scripts/build.mjs",
        cache: {
          input,
          output: ["dist/**", "src/ui/client.generated.html"],
        },
      },
      // Format, lint and type check, the last against each file's own tsconfig.
      check: { command: "vp check", cache: check },
      "lint:sh": {
        command:
          // `&&` parts run without a shell: the glob needs one.
          "jiti scripts/generate-shell-corpus.ts --check && sh -c 'shellcheck -s sh tests/shell/corpus/*.sh'",
        cache: check,
      },
      "lint:boundaries": { command: "depcruise src tests claude", cache: check },
      analyze: { command: "fallow --summary --quiet", cache: check },
      "test:unit": {
        command: "vitest run --project unit",
        dependsOn: ["build"],
        cache: flagged,
      },
      "test:workflows": {
        command: "vitest run --project workflows",
        dependsOn: ["build"],
        cache: flagged,
      },
      "test:e2e:inmem": {
        command: "vitest run --project e2e-inmem",
        dependsOn: ["build"],
        cache: flagged,
      },
      "test:e2e:live": {
        command: "vitest run --project e2e-live --no-file-parallelism",
        dependsOn: ["build"],
        cache: flagged,
      },
      "test:web": { command: "vitest run --project storybook", cache: flagged },
      // The task sets scripts/test-states.ts plans: `vp run` takes one task name.
      gate: { command: "true", cache: false, dependsOn: [...TASKS] },
      "gate:tests": { command: "true", cache: false, dependsOn: [...VITEST_TASKS] },
    },
  },
})
