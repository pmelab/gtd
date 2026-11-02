# Development

```bash
npm install
npm run dev          # run from source, no build (node dev/run.mjs)
npx vp run build     # vp pack → dist/gtd.bundle.mjs, dist/gtd.core.mjs (minified, no ui or lsp) and the subpath entries
npm test             # the whole gate, via vp run — cached and parallel
npm test -- --no-cache          # bypass the cache; vp run options after -- reach every run
npx vp run test:unit            # one task, cached (add --no-cache before the task name to bypass)
npx vp run test:workflows       # each workflow's .feature files, in memory
npx vp run test:e2e:live        # builds first (dependsOn), then @live
npm run test:changed # local pre-flight: only unit/@inmem tests git says changed
npm run test:mutation # StrykerJS mutation testing (manual only, ~10 min)
npx vp run check     # format, lint and type check
npx vp run build && npm run bench:replay # git-history replay timing (manual only, not gated; ~90s + a 50k-commit fixture build)
```

To try a change by hand — the real `gtd` from this checkout, a scratch
repository, stand-ins for the agent, `gh` and the browser — follow
[.claude/skills/run-gtd/SKILL.md](../.claude/skills/run-gtd/SKILL.md). Never run
gtd inside this checkout itself.

`npm test` runs the tasks in `vite.config.ts` with
[`vp run`](https://viteplus.dev/guide/run): a task whose inputs are unchanged
since its last green run is skipped, and the others run in parallel. Inputs are
the files a task actually read, tracked automatically. The first failing task
stops the run.

Only failing states' logs print. When a flag state fails the same way as an
earlier one, it prints one `same failure as <state>` line instead of repeating
the log. A failing state that prints nothing beyond vp's own task lines is
always shown in full, never collapsed. `--log labeled` is always passed; a
`--log` of your own replaces it and turns collapsing off unless it is `labeled`.
`npm test -- --full` prints every state's full log, passes included, and never
collapses.

A pre-commit hook is installed automatically via the `prepare` script when you
run `npm install` on a fresh clone — it runs `vp staged`, which formats staged
files with `vp fmt`, mirroring the `check` task enforced in CI.

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
