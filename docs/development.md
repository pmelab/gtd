# Development

```bash
npm install
npm run dev          # run from source, no build (node dev/run.mjs)
npm run build        # tsdown → dist/gtd.bundle.mjs
npm test             # format:check, typecheck, lint, unit + e2e tests, fallow
npm run test:unit    # vitest unit tests (the pure resolver) — --project unit
npm run test:e2e     # gherkin e2e via vitest + quickpickle — --project e2e
npm run test:mutation # StrykerJS mutation testing (manual only, ~2 min)
npm run typecheck
npm run lint
```

## Pre-commit hook

A pre-commit hook is installed automatically via the `prepare` script when you
run `npm install` on a fresh clone — no manual setup needed. The hook runs
[lint-staged](https://github.com/lint-staged/lint-staged) with
[oxfmt](https://oxc.rs/docs/guide/usage/formatter.html), formatting every staged
file before each commit (`oxfmt --no-error-on-unmatched-pattern --write`),
mirroring the `format:check` step enforced in CI (`oxfmt --check .`).

## Prompt templates

Each prompt-bearing state has a self-contained Eta template in
`src/prompts/*.md` that owns its full prompt — header, context, and body. Shared
fragments live as partials in `src/prompts/partials/`: `header`, the context
renderers (`diff`, `feedback`, `package`), and the single `agent-turn` tail
partial (the pinned "Finish your turn by running `gtd step-agent`. Then run
`gtd next` …" loop-closing instructions).

At module load, `src/Prompt.ts` registers every template on a single `new Eta()`
instance via `loadTemplate`. `readFile` and `resolvePath` are nulled afterward
so rendering resolves exclusively from the in-memory cache — the compiled ESM
bundle carries no runtime `fs` dependency.

`buildPrompt(result, resolveModel?, output?)` selects the state's template,
builds a view-model (model string, tail partial name, context), renders it,
collapses runs of three or more blank lines to two, and ensures exactly one
trailing newline. It throws for the five states that render no prompt at all
(`testing`, `planning`, `close-package`, `done`, `health-check`) — those are
performed entirely by the edge.

`npm run dev` runs `src/main.ts` directly via Node's native TypeScript
type-stripping (requires Node 22.6+). It registers `dev/hooks.mjs`, which fills
the two gaps the tsdown build otherwise covers: resolving `./Foo.js` specifiers
to the on-disk `./Foo.ts`, and importing `*.md` prompt files as text. Pass CLI
args after `--`, e.g. `npm run dev -- format <file>`.

The decision core (`src/Machine.ts`) is pure and IO-free, so the whole state
ladder and the counter folds are trivially unit-testable in isolation; all
git/filesystem IO is confined to the edge (`src/Events.ts`).

`npm run build` produces `dist/gtd.bundle.mjs`, which npm exposes as the `gtd`
binary via the `bin` field in `package.json`.

## Mutation testing

Run mutation testing on-demand with `npm run test:mutation` (StrykerJS, ~2 min)
— never run it as part of routine development; it is a deliberate,
manually-triggered check. The single `stryker.config.json` mutates six core
files:

```
src/Machine.ts  src/Prompt.ts  src/Config.ts
src/Format.ts   src/State.ts   src/Events.ts
```

`src/Git.ts` is excluded: the Cucumber harness stubs git at the Effect boundary,
so `Git.ts` mutants have zero in-memory coverage.

The HTML report lands in `reports/mutation/mutation.html` (git-ignored).

## Releasing

Releases are automatic. Push releasable Conventional Commits (`fix:`, `feat:`,
or breaking changes) to `main` and the Release workflow runs the tests, then
`npx semantic-release`. Semantic-release computes the next version, writes it
into `package.json`, builds the bundle, commits the bump back as
`chore(release): X.Y.Z [skip ci]`, tags `vX.Y.Z`, and creates the GitHub release
with `gtd.bundle.mjs` attached.
