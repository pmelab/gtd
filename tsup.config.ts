import { defineConfig } from "tsup"

export default defineConfig({
  entry: { gtd: "src/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  noExternal: [/.*/],
  splitting: false,
  loader: { ".md": "text" },
  banner: {
    js: `#!/usr/bin/env node
import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);`,
  },
  clean: true,
})
