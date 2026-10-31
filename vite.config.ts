import { defineConfig } from "vite-plus"
import { TASKS, VITEST_TASKS } from "./scripts/test-states.ts"

// Spike: turbo.json's tasks as Vite Task tasks. Inputs are auto-tracked; only
// what auto-tracking cannot see (env, build outputs) is declared.
// Auto-tracking records directory listings and ignores .gitignore: without
// these, build's own writes invalidate every task that walks the tree.
const input = [{ auto: true }, "!dist/**", "!src/ui/client.generated.html"]
const check = { input, untrackedEnv: ["TMPDIR", "TERM"], output: [] }
const flagged = { ...check, env: ["GTD_FLAG_*"] }

export default defineConfig({
  run: {
    tasks: {
      build: {
        command:
          "tsdown --filter web && npx @tailwindcss/cli -i src/web/styles.css -o dist/web/main.css --minify && node scripts/inline-web-client.mjs && tsdown --filter gtd --filter core && tsdown --filter entrypoints && node scripts/assert-no-test-doubles.mjs",
        cache: {
          input,
          output: ["dist/**", "src/ui/client.generated.html"],
        },
      },
      "format:check": { command: "oxfmt --check .", cache: check },
      typecheck: {
        command: "tsc --noEmit && tsc --noEmit -p src/web/tsconfig.json",
        cache: check,
      },
      lint: { command: "oxlint .", cache: check },
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
