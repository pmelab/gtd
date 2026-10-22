## Documentation

**The code is the source of truth. Documentation exists only to tell a USER
something the code cannot.** That means: how to install and run gtd, what its
commands, flags, config keys, and driver protocol accept, and what the bundled
workflow asks of a person using it. Nothing else.

Never write — and never keep — documentation that describes how gtd is BUILT:
module boundaries, data flow, call sequences, which file owns which invariant,
walkthroughs of the engine. Such a document is redundant the day it is written
and wrong shortly after, and a reader who trusts it is worse off than one who
read the code. When you find one, DELETE it rather than update it.

- No documentation file duplicates a fact the code already states — no
  architecture overview, no internals guide, no "how the engine works"
- Prose in `docs/`, `README.md`, or this file must not name a `src/*.ts` module,
  an internal function, or a private type. If a reader needs that, they need the
  code
- A non-obvious constraint that lives nowhere else belongs in a TEST (which
  fails when it is violated) or a short comment at the code it constrains —
  never in markdown
- `CONTEXT.md` is the one exception, and it is a GLOSSARY, not architecture: the
  domain language this repo uses, including the words to avoid. Read it before
  naming anything, and keep architecture out of it

## Commit messages

Squash commits, PR titles and gtd's closing message follow
[docs/commits.md](docs/commits.md). Whether a change is breaking (`!`) is
decided by the tiers in [COMPATIBILITY.md](COMPATIBILITY.md).

## Testing

- `npm run test:mutation` is a deliberate user action — never run it
  autonomously; it takes 10+ minutes and is only meaningful when triggered on
  purpose
- never run a process in the background when its output is what you are after —
  a long test run, an eval, a build. Run it in the foreground and wait for the
  result; a backgrounded run gets reported on from a partial log or not at all
- create cucumber.js scenarios for each new feature, tagged `@inmem`. `@live` is
  for the few scenarios only a real process shows — a signal's exit status, a
  real shell, the bundled binary's wiring — never for logic
- reach every external resource (git, a shell, a file outside the repository,
  the network, a spawned program) through a port with a live and an in-memory
  implementation, and hold the two together with a contract test that runs the
  same cases against both. A scenario needing a resource the in-memory tier
  lacks is a missing twin, not a reason to go `@live`
- use composable "Given" steps (small, reusable steps) instead of one-off setup
  steps
- make Given steps generic and expose actual file content/changes in scenario
  text — don't hide setup behind abstract step names
- inline setup logic into step definitions rather than chaining helpers; each
  step maps to one commit
- `docs/driver.md`'s "A complete minimal driver" section is DOC-TESTED, not just
  prose: `tests/integration/features/driver-doc.feature` extracts its fenced
  bash block verbatim (`tests/integration/helpers/driver-doc.ts`) and runs it as
  a real driver. The heading text and the single fence are load-bearing —
  renaming the heading or splitting the paste across more than one fence fails
  the extraction, not just a stale doc. The extracted script is spawned with
  only `$PATH` (a shim dir first) and `$HOME` — any new env dependency the paste
  grows must be documented in its own Prerequisites section, and is a scenario
  failure until it is
- `docs/cli.md`'s `## Commands` block and its exit-code table are PINNED equal
  to the rendered help output and the exit-code set — they are generated views
  under test, not prose to hand-maintain

### Task graph and caching

`npm test` is a runner that wraps `turbo run` once per release-flag state — the
runner pins every release flag explicitly (`GTD_FLAG_<NAME>=1`/`0`; the
in-memory tier picks it up from the ambient env, explicit test env wins): a base
state at registry defaults, then each release flag flipped alone, so each
release flag adds a full vitest pass to every gate and CI. It is not a serial
`&&` chain — each check is a task with its own `inputs`, so it's cached (skipped
when its inputs are unchanged since the last green run) and run in parallel with
the others. Two rules a future change must not break: adding a check means
adding all three of a `package.json` script, a `turbo.json` task with an
explicit `inputs` array, and that task's name in the runner's `TASKS` list — a
task missing any of the three fails `tests/tooling/turbo.test.ts`. And
under-declared `inputs` cache a stale green: the canonical example is `docs/**`
in `test:unit` and both e2e tasks' `inputs`, because
`tests/integration/features/driver-doc.feature` runs `docs/driver.md` as
executable code — omitting it would let a broken doc pass on a cached result.

### Import rules

`lint:boundaries` runs dependency-cruiser over `src/`, `tests/` and `claude/`.
Its rules are generic over path shape — they back-reference the boundary
directory and file name they matched — so a new `src/<boundary>/` needs only its
own `index.ts` and a place in the unit map, the commented rule set in
`.dependency-cruiser.mjs` that says which units, and which npm packages, each
unit may import. There is no baseline: a violation is a real finding to fix,
never one to record. CI uploads the current graph as the `unit-map` artifact.

Two conventions the rules read: a `*.fixture.ts` beside an implementation is
test-support any test in that boundary may import, and a test may reach a
neighbouring module only through its boundary's `index.ts` — if a symbol is not
worth publishing there, the test wanting it is testing the wrong thing.

### `.gtd/` is formatted, not ignored

`.gtd/` carries no `.prettierignore` entry — every file under it, steering files
included, is oxfmt-formatted and covered by `format:check` like the rest of the
repository. A committed steering file that is not an oxfmt fixed point reds
every gate that runs the test suite: `start-gate`, `review-gate`, and
`fix-precheck` alike.

Two mechanisms keep files there conforming, and neither is new code: husky →
lint-staged runs `oxfmt --write` over staged files during the step commit, and a
step that declares a `mode` carries its own `format:`/`validate:` pair, run by
the DRIVER (via `gtd next --json`'s `validate` field, or `gtd validate`) ahead
of `gtd land` — never emitted into the landing script.

## Manual testing

To test a change by hand — build this checkout, start a process in a scratch
repository, reach a criterion's behaviour and observe it — follow the `run-gtd`
project skill,
[.claude/skills/run-gtd/SKILL.md](.claude/skills/run-gtd/SKILL.md). Its worked
example is DOC-TESTED by
`tests/integration/features/manual-testing-doc.feature`, like the minimal
driver: the `## Worked example` heading and its single bash fence are
load-bearing. Its rules hold for every hand-run:

- never run gtd in this checkout — it may host a live process, and a land here
  commits or reverts that process's work
- never export `GIT_DIR` or `GIT_WORK_TREE` — the scratch run then commits onto
  this checkout's branch
- at most 2 gtd loops at once, the test suite included

## Comments

Keep a comment — module doc comment or per-export JSDoc alike — only where it
explains an important decision or genuinely unclear code, and keep it as short
as the fact allows. Everything else (restatement of the code, history, a "what"
with no "why") gets deleted, not moved. Machine-read lines are exempt: oxlint
`eslint-disable` pragmas, `shellcheck disable=` directives, and `#!` shebangs
stay, because tooling reads them. No lint rule or comment-density check enforces
this — it isn't a countable property, so human review is the gate.

Because architecture is NOT documented in markdown, a comment is where a
non-obvious invariant lives. Put it at the code it constrains, and keep it to
the decision and its reason — never a summary of the module.

## Changing the workflow

A workflow is CODE, not data: the shipped workflows are plain TypeScript under
`src/workflows/`, published as `@pmelab/gtd/workflows` and reaching gtd only
through a repository's `gtd.config.ts`, which imports them or their parts. There
is no engine-side wiring to trace when its shape changes — edit the flow. The
tests that pin it are the unit tests and `.feature` files beside it in
`src/workflows/` (`npm run test:workflows`), and the e2e features that set a
workflow up with a `gtd config file at "gtd.config.ts"` step; they tell you what
you broke. A step's full name is public API.

The one thing those tests cannot tell you: every step a process can rest at must
resolve to exactly one content kind a driver already handles
(`capture`/`message`/`script`/`prompt`/`stalled`). There is no sixth kind to add
without changing every driver in the world.
