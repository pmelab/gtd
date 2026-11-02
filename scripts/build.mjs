// One command, so `vp run` caches the build as one unit: cached per `&&` part,
// a replayed later part restored its older dist/** over the parts that had just
// rebuilt it.
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// Up to and including the inline step: what src/ui/Server.ts imports.
export const WEB_CLIENT_STEPS = [
  "vp pack --filter web",
  "npx @tailwindcss/cli -i src/web/styles.css -o dist/web/main.css --minify",
  "node scripts/inline-web-client.mjs",
]

const BUILD_STEPS = [
  ...WEB_CLIENT_STEPS,
  "vp pack --filter gtd --filter core",
  "vp pack --filter entrypoints",
  "node scripts/assert-no-test-doubles.mjs",
]

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const step of BUILD_STEPS) execSync(step, { stdio: "inherit" })
}
