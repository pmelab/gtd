// Dev entry: register the TS/`.md` resolution hooks, then run the CLI from
// source so `npm run dev` works without a tsup build. argv is preserved, so
// `npm run dev -- format <file>` reaches `src/main.ts` unchanged.
//
// Lives in `dev/` (not `scripts/`) because tsup builds with `clean: true` into
// `scripts/`, which would wipe these helpers on every build.
import { register } from "node:module"

register("./hooks.mjs", import.meta.url)

await import("../src/main.ts")
