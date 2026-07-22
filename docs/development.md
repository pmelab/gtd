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

## Templates

Every state's content (`script`/`prompt`/`message`/`commit`) is an Eta template
string, rendered by `src/PatternTemplates.ts`'s `renderStateTemplate` against
the variable set documented in
[Configuration](configuration.md#template-variables). There is no template-file
registry to keep in sync: a workflow's content strings are either inline in its
YAML/`.gtdrc` or a `./`-relative file reference auto-inlined at config load
(`src/PatternConfig.ts`) — see
[Configuration](configuration.md#content-values-inline-or-a-file-reference). The
bundled default workflow (`src/workflows/default.yaml`) is imported as raw text
via tsdown's `.yaml`-as-text loader (`tsdown.config.ts`) and compiled through
the same path a `.gtdrc` `workflow:` key goes through
(`src/workflows/default.ts`) — no privileged code path.

`npm run dev` runs `src/main.ts` directly via Node's native TypeScript
type-stripping (requires Node 22.6+). It registers `dev/hooks.mjs`, which
resolves `./Foo.js` specifiers to the on-disk `./Foo.ts` and imports `*.yaml`
files as raw text, mirroring tsdown's `.yaml`-as-text loader — this is what lets
`src/workflows/default.yaml` resolve when running from source.

The decision core is pure and IO-free: the pattern machine's shape (states,
patterns, retry) is a plain-data `WorkflowDefinition` (`src/PatternMachine.ts`),
and the same module's `resolveState`/`step` are the pure resolver/interpreter
over it — so the whole engine is trivially unit-testable in isolation; all
git/filesystem/template IO is confined to the edge (`src/Edge.ts`).

`npm run build` produces `dist/gtd.bundle.mjs`, which npm exposes as the `gtd`
binary via the `bin` field in `package.json`.

## Mutation testing

Run mutation testing on-demand with `npm run test:mutation` (StrykerJS) — never
run it as part of routine development; it is a deliberate, manually-triggered
check. `stryker.config.json`'s `mutate` list names the v3 pattern-machine module
set (`src/PatternMachine.ts`, `src/PatternConfig.ts`, `src/PatternTemplates.ts`,
`src/Edge.ts`, `src/Config.ts`, `src/Format.ts` — see
[Architecture](../AGENTS.md#the-pattern-machine-module-map) for the v3 module
map).

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
