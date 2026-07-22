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

## The LSP server

`gtd lsp` (`src/Lsp.ts`) serves editor tooling over `.gtd/`'s two steering-file
formats — document symbols and diagnostics for `.gtd/TODO.md`'s open questions
and `.gtd/REVIEW.md`'s review chunks/hunks, plus check/uncheck code actions for
the latter. It's keyed on file NAME, not workflow state: a v3 workflow declares
no state→file mapping (a state names no file), so the server needs no
git/`.gtdrc` dependency at all and serves whatever content the editor hands it
over the LSP protocol, exactly like any other document.

`src/OpenQuestions.ts` and `src/ReviewDoc.ts` are the pure parsers behind both
the LSP and the bundled default workflow's own bash validators
(`todo-validating`/`review-validating` in `src/workflows/default.yaml`) — see
[docs/design/steering-file-loops.md](design/steering-file-loops.md) for the
"executable spec ↔ bash validator" contract linking the two independent
implementations, and each module's own doc comment for the format it defines.
Their unit tests are that format's spec tests.

## Mutation testing

Run mutation testing on-demand with `npm run test:mutation` (StrykerJS) — never
run it as part of routine development; it is a deliberate, manually-triggered
check. `stryker.config.json`'s `mutate` list names the v3 pattern-machine module
set (`src/PatternMachine.ts`, `src/PatternConfig.ts`, `src/PatternTemplates.ts`,
`src/Edge.ts`, `src/Config.ts`, `src/Format.ts` — see
[Architecture](../AGENTS.md#the-pattern-machine-module-map) for the v3 module
map), plus the steering-file format parsers and the LSP built on them
(`src/OpenQuestions.ts`, `src/ReviewDoc.ts`, `src/Lsp.ts` — see
["The LSP server"](#the-lsp-server) below). `src/Lsp.ts`'s protocol-adapter tail
(`startLspServer`) is exercised only by the `@live` e2e (excluded from the
mutation run's Cucumber harness), so mutants confined to that tail may survive
without it being a coverage gap in the ordinary test suite — the pure
symbol/edit/diagnostic builders above it are unit-tested and mutation-checked
normally.

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
