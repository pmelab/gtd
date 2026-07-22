import { defineConfig } from "tsdown"

export default defineConfig({
  entry: { "gtd.bundle": "src/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  outExtensions: () => ({ js: ".mjs" }),
  loader: { ".md": "text", ".yaml": "text" },
  banner: {
    js: `#!/usr/bin/env node
import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);`,
  },
  clean: true,
  deps: {
    alwaysBundle: [/.*/],
  },
  dts: false,
  outputOptions: { codeSplitting: false },
})
