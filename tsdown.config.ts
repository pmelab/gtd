import { defineConfig } from "tsdown"

// Two configs, browser-first: the phone/web client bundles for the browser
// platform, then `scripts/inline-web-client.mjs` folds its output into
// src/web/generated.html (gitignored), which the node config below imports
// through the ".html" text loader — the same mechanism src/Visualize.ts
// already uses for its hand-written visualize.html. tsdown builds array
// entries in PARALLEL (see its `buildWithConfigs`), so this ordering is not
// self-enforcing — `npm run build`'s script runs `tsdown --filter web`,
// the inline step, then `tsdown --filter gtd` as three separate sequential
// steps, using each config's `name` to select it.
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
    // exceptions.
    deps: { alwaysBundle: [/.*/] },
    outputOptions: { codeSplitting: false },
  },
  {
    name: "gtd",
    entry: { "gtd.bundle": "src/main.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    outExtensions: () => ({ js: ".mjs" }),
    loader: { ".md": "text", ".yaml": "text", ".html": "text" },
    banner: {
      js: `#!/usr/bin/env node
import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);`,
    },
    clean: true,
    dts: false,
    outputOptions: { codeSplitting: false },
  },
])
