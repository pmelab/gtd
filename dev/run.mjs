// Lives in `dev/`, not `scripts/`: tsdown builds with `clean: true` into
// `scripts/`, which would wipe these helpers on every build.
import { register } from "node:module"

register("./hooks.mjs", import.meta.url)

await import("../src/main.ts")
