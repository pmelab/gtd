# Development

```bash
npm install
npm run dev          # run from source, no build (node dev/run.mjs)
npm run build        # tsdown → dist/gtd.bundle.mjs
npm test             # the whole gate, via turbo — cached and parallel
npm test -- --force  # bypass turbo's cache; turbo options after -- reach every turbo run
npx turbo run test:unit         # one task, cached (add --force to bypass)
npm run test:workflows          # each workflow's .feature files, in memory
npx turbo run test:e2e:live     # builds first (turbo dependsOn), then @live
npm run test:changed # local pre-flight: only unit/@inmem tests git says changed
npm run test:mutation # StrykerJS mutation testing (manual only, ~10 min)
npm run typecheck
npm run lint
npm run build && npm run bench:replay # git-history replay timing (manual only, not gated; ~90s + a 50k-commit fixture build)
```

To try a change by hand — the real `gtd` from this checkout, a scratch
repository, stand-ins for the agent, `gh` and the browser — follow
[.claude/skills/run-gtd/SKILL.md](../.claude/skills/run-gtd/SKILL.md). Never run
gtd inside this checkout itself.

`npm test` is a turbo task graph (`turbo.json`): each check declares its own
`inputs`, so an unchanged check is skipped, and a check that does run is run in
parallel with the others. Caveat from the `test:e2e:live` task's `build`
dependency: a bare `npm run test:e2e:live` skips the build, so use
`npx turbo run test:e2e:live` to test against a fresh bundle.

Only failing tasks' logs print. When a flag state fails the same way as an
earlier one, it prints one `same failure as <state>` line instead of repeating
the log. A failing state that prints nothing beyond turbo's and npm's own
preamble is always shown in full, never collapsed. `--log-prefix=task` is always
passed; a `--log-prefix` of your own replaces it and turns collapsing off unless
it is `task`. `npm test -- --output-logs=full` prints every state's full log,
passes included, and never collapses; `--output-logs=hash-only` and `none` print
no failure log, so they also turn collapsing off; `new-only` replaces the
default and still collapses.

A pre-commit hook is installed automatically via the `prepare` script when you
run `npm install` on a fresh clone — it runs
[lint-staged](https://github.com/lint-staged/lint-staged) with
[oxfmt](https://oxc.rs/docs/guide/usage/formatter.html), mirroring the
`format:check` step enforced in CI.

Releases are automatic: push releasable Conventional Commits (`fix:`, `feat:`,
or breaking changes — see [Commit messages](./commits.md)) to `main` and
semantic-release computes the next version, builds the bundle, tags it, and
publishes it to npm's `next` dist-tag. `latest` trails behind: the Release
workflow's daily schedule (or a manual run with no input) moves it to the newest
`next`, and does nothing when they already match — so users on `latest` get one
batch a day, however many majors landed.

Promotion needs **Allow npm dist-tag** enabled on the package's npm trusted
publisher configuration; no npm token is stored.

If a release's tag is pushed but its publish fails, later runs skip that
version. Run the Release workflow manually with `backfill` set to the version
(e.g. `17.1.0`) to publish it from its tag — with provenance, without moving
`latest`, moving `next` only if it is the newest release — and create its GitHub
release with the bundle if it is missing.
