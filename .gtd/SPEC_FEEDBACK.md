# Spec feedback — 01-serve-and-client-harness

Range re-inspected: `64dd325f` → working tree, fresh pass. **Every T1–T9
criterion I could exercise now holds**: `npm test` is green on a forced
(cache-bypassed) run of `format:check typecheck lint test:web deadcode`,
`npx turbo run build` now restores `src/web/generated.html` from cache (the
previous round's stale-green hazard is gone), the tRPC refusal crosses a real
HTTPS socket with `stdout`/`stderr`/`exitCode` separately readable, a
`react-hooks/rules-of-hooks` violation in `src/web/` does fail `lint` (verified
with a throwaway probe file, since removed), and `test:web` really runs
`App.stories.tsx` as a browser test.

Four problems remain.

## 1. `turbo.json`'s `lint` inputs omit `.storybook/**`, so a lint error there replays a cached green

T7 requires `.storybook/` config files to be "covered by `format:check` and
`lint`". `oxlint .` does lint them — but `turbo.json`'s `lint` task declares
`inputs: ["src/**", "tests/**", "scripts/**", "dev/**", "evals/**", "*.ts", "*.mjs", ".oxlintrc.json"]`.
`.storybook/main.ts` matches none of those: `*.ts` is root-level only.

Reproduced on this tree:

```
npx turbo run lint                                        # green, cached
echo 'export const bad = () => eval("1")' > .storybook/__probe.ts
npx turbo run lint                                        # >>> FULL TURBO, still green
npx oxlint .                                              # error no-eval, .storybook/__probe.ts:1
```

This is exactly the under-declared-`inputs` stale green AGENTS.md's "Task graph
and caching" section names. Add `.storybook/**` to `lint`'s `inputs`.

(`format:check` is fine — it declares no `inputs`, so it never caches a subset.
`typecheck` and `deadcode` genuinely do not reach `.storybook/`: the root
tsconfig's `include` is `["src", "tests"]` and fallow reports 0 dead files of
167, so neither needs the entry.)

## 2. Three `serve.feature` scenarios pass only because this machine has no tailnet

`tests/integration/features/serve.feature` asserts
`stderr contains "no Tailscale interface found to bind to, and no --host given"`
in three scenarios. Those spawn the real `gtd` bundle, so `resolveBindHost`'s
default `pickHost` reaches the real `os.networkInterfaces()`. On any machine or
CI runner joined to a tailnet, `pickBindHostFromSystem()` returns a
`100.64.0.0/10` address, `gtd serve` proceeds past that refusal, and all three
scenarios red — with a failure that reads as a serve bug.

The fix turn addressed the identical hazard in `src/serve/Server.test.ts` and
`src/program.test.ts` with `vi.mock("./serve/Bind.js", ...)`. A spawned
subprocess cannot be mocked that way and no env override exists, so the e2e tier
still carries it. Give the bind scan a test seam the subprocess honors, or drop
the assertion to something environment-independent.

## 3. `src/**/*.test.ts` now requires a prior build, and neither `test:mutation` nor a bare `npm run test:unit` provides one

`src/serve/Server.ts` imports `../web/generated.html`, which is gitignored and
only exists after `npm run build`. The turbo tasks were given
`dependsOn: ["build"]`, which covers `npm test`. Two sanctioned entry points
were not:

- `npm run test:mutation` (`stryker run`) has no build step, and stryker's
  sandbox copies the file only if it already exists. `src/serve/Server.ts`
  reaches most of `src/**/*.test.ts` transitively (via `program.ts`, `Cli.ts`,
  and `src/testing/Layers.ts`), so on an unbuilt checkout the whole 10-minute
  run reds on an unresolvable import.
- `npm run test:unit` / `npm run test:changed` invoked directly, same reason.

Not verified by running mutation testing — AGENTS.md forbids that autonomously.
Verified only that the import exists, that the file is gitignored, and that
stryker honours no `.gitignore` (only its own `ignorePatterns`).

## 4. `serve.loop`'s published schema description promises Eta templating that nothing compiles

`src/ConfigSchema.ts`'s `serveJsonSchema` describes `loop` as a "Shell command
template (Eta, like `modes:`'s format/validate)". `ServeSchema` is a plain
`Schema.Struct` and `Config.ts`'s `toOperations` passes `decoded.serve` through
verbatim — no Eta compile, deliberately, per `ServeSchema`'s own doc comment
("it needs no Eta-template compile step"). Those two comments contradict each
other, and `schema.json` ships in the npm tarball, so the false one is what a
user sees in editor autocomplete. `docs/configuration.md` already drops the Eta
claim; make the schema description match.

(For the record, T1's prose asked for "an optional unknown value" compiled "as a
fourth entry" beside workflow/vars/modes. The implementation used a real
`Struct` with no compiler instead. That deviation is right — `Schema.Unknown`
cannot reject an excess sub-key, which T1's second criterion demands — and it is
documented at the code. No change wanted; only the stale Eta sentence.)
