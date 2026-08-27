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

## Testing

- `npm run test:mutation` is a deliberate user action — never run it
  autonomously; it takes 10+ minutes and is only meaningful when triggered on
  purpose
- create cucumber.js scenarios for each new feature
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

`npm test` runs through Turborepo (`turbo.json`), not a serial `&&` chain — each
check is a task with its own `inputs`, so it's cached (skipped when its inputs
are unchanged since the last green run) and run in parallel with the others. Two
rules a future change must not break: adding a check means adding all three of a
`package.json` script, a `turbo.json` task with an explicit `inputs` array, and
that task's name to the `test` script's task list — a task missing any of the
three fails `tests/tooling/turbo.test.ts`. And under-declared `inputs` cache a
stale green: the canonical example is `docs/**` in `test:unit` and both e2e
tasks' `inputs`, because `tests/integration/features/driver-doc.feature` runs
`docs/driver.md` as executable code — omitting it would let a broken doc pass on
a cached result.

### `.gtd/` is formatted, not ignored

`.gtd/` carries no `.prettierignore` entry — every file under it, steering files
included, is oxfmt-formatted and covered by `format:check` like the rest of the
repository. A committed steering file that is not an oxfmt fixed point reds
every gate that runs the test suite: `start-gate`, `review-gate`, and
`fix-precheck` alike.

Two mechanisms keep files there conforming, and neither is new code: husky →
lint-staged runs `oxfmt --write` over staged files during the step commit, and a
state that declares a `mode:` carries its own `format:`/`validate:` pair, run by
the DRIVER (via `gtd next --json`'s `validate` field, or `gtd validate`) ahead
of `gtd land` — never emitted into the landing script.

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

A workflow is DATA, not code: `src/workflows/unified.yaml` is the bundled
default, and there is no engine-side wiring to trace when its shape changes.
Edit the YAML; the tests that pin its shape (`src/workflows/templates.test.ts`
and the e2e features that set it up with the `Given the workflow` step) tell you
what you broke.

The one thing those tests cannot tell you: every state a process can rest at
must resolve to exactly one content kind a driver already handles
(`capture`/`message`/`script`/`prompt`/`stalled`). There is no sixth kind to add
without changing every driver in the world.
