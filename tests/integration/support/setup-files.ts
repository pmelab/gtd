export const SETUP_FILES: readonly string[] = [
  // `ui.steps.ts` MUST load first: its `vi.mock("../../../../src/ui/Bind.js", ...)`
  // must register before `world.ts`'s static `import { runCli } from "../../../src/Cli.js"`
  // eagerly loads the real `Bind.js` transitively — once that real module is
  // loaded and cached, a `vi.mock` registered by a LATER setup file never
  // takes effect.
  "./tests/integration/support/steps/ui.steps.ts",
  "./tests/integration/support/world.ts",
  "./tests/integration/support/hooks.ts",
  "./tests/integration/support/steps/common.steps.ts",
  "./tests/integration/support/steps/config.steps.ts",
  "./tests/integration/support/steps/formatting.steps.ts",
  "./tests/integration/support/steps/driver-doc.steps.ts",
  "./tests/integration/support/steps/lsp.steps.ts",
  "./tests/integration/support/steps/review-signoff.steps.ts",
  "./tests/integration/support/steps/review-window.steps.ts",
  "./tests/integration/support/steps/steering.steps.ts",
  "./tests/integration/support/steps/repo-snapshot.steps.ts",
  "./tests/integration/support/steps/signal-exit.steps.ts",
  "./tests/integration/support/steps/tmpdir-gitdir.steps.ts",
  "./tests/integration/support/steps/ui-lifecycle.steps.ts",
]
