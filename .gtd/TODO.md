# Loop-driver flags: `--edit` and `--once` (issue #127)

Add two orthogonal loop-driver flags to `bin/gtd`, each on one axis, combining
freely. Everything lives at the bash edge (`bin/gtd`); the compiled bundle and
the pure engine are untouched.

## The two axes

- **Editor-aggressiveness** — one axis, three values: `force` / `auto` /
  `never`. Today it's split across `--no-edit` (a flag) and the dead-end `edit`
  subcommand. Unify it into one tri-state driven by `--edit` / (default) /
  `--no-edit`.
- **Loop length** — `--once` restricts the run to a single beat. Independent of
  the editor axis; the two combine freely (`gtd --edit --once`).

## Decisions (judgement calls, with rationale)

- **Keep `gtd edit [path]` as documented plumbing** rather than deleting it. The
  issue permits keeping it "if a pure non-looping file-opener is still wanted
  for keybindings/Herdr" — it is (it has its own `edit.feature`, docs, and is a
  reasonable keybinding target). `--edit` is the _loop-driving_ counterpart;
  `gtd edit` stays the _non-looping_ opener. Docs will frame `gtd edit` as
  plumbing and point workflow users at `--edit`.
- **`--edit` and `--no-edit` together is a usage error (exit 2).** They're two
  values of the _same_ axis, not orthogonal flags — combining them is
  contradictory, so reject it rather than pick a winner silently.
- **`force` vs `auto` differ only in two spots**, because at a human gate both
  open the editor identically. `force` additionally (a) overrides an ambient
  `GTD_NO_EDIT` back to editing for this run, and (b) at a _non_-human rest
  emits an honest one-line notice and resumes driving **without** opening the
  editor. Not opening at a non-human rest is deliberate: a forced hand-edit
  there would be captured under the wrong actor or refused out-of-turn (the
  issue's honesty caveat), and opening-but-not-capturing risks a stray pending
  edit getting miscaptured by the next agent/check turn. So `force` at a
  non-human rest = "say so and just resume driving," literally.
- **No `-1`/`--single-step` alias for `--once`, no `GTD_ONCE`/`GTD_EDIT` env
  mirrors.** The issue lists `--once` as the chosen name and only `--no-edit`
  needs an env mirror (CI/driver use). `-e` _is_ added for `--edit` because the
  issue's table names it explicitly. Keeps the surface minimal and orthogonal.
- **`--once` beat definition:** at most one pass through the dispatch, then
  `exit 0`. The opening-move gate handling counts as the beat when the machine
  rests at a `"message"` gate; otherwise the first `while` iteration is the
  beat. Equivalent to "one iteration of the `while true` body → at most one
  commit / one transition."

## `bin/gtd` changes

### 1. Replace the `--no-edit`-only dispatch with a tri-state flag parser

Replace the current block (`bin/gtd:209-222`, the `edit_disabled` setup + the
two `--no-edit` position checks) with a parser that recognizes `--edit`/`-e`,
`--no-edit`, and `--once` in the two sanctioned positions (bare, or immediately
after `loop`), lets them combine, and strips them before any later dispatch sees
`"$@"`:

- `edit_mode` = `auto` (default) | `force` | `never`. Seed `never` from a
  non-empty `GTD_NO_EDIT` (unchanged env contract); a flag then overrides.
- `once=0`.
- Strip an optional leading `loop` keyword into a `had_loop` flag (so the
  existing `'loop' takes no arguments` wording is preserved).
- Consume a leading run of flags with a `while`/`case`:
  - `--edit|-e` → `edit_mode=force`, mark `saw_force`.
  - `--no-edit` → `edit_mode=never`, mark `saw_never`.
  - `--once` → `once=1`.
  - anything else → break.
- `saw_force && saw_never` →
  `echo "gtd: --edit and --no-edit are mutually exclusive" >&2; exit 2`.
- If a flag was consumed **or** `had_loop`, this is an explicit loop invocation:
  the remainder must be empty. If not empty → usage error exit 2
  (`'loop' takes no arguments` when `had_loop`, else
  `gtd: unexpected argument '<x>' after loop flags`). Otherwise `set -- loop` to
  normalize into the existing loop fall-through.

This subsumes the old position-strict `--no-edit` handling, still forwards real
subcommands (`gtd status`, `gtd edit`, `gtd log` — none start with a recognized
flag, so the `while` breaks immediately and `"$@"` is untouched), and still
rejects `gtd loop extra`. A recognized flag after a real subcommand
(`gtd status --edit`) is never stripped here, so it reaches the bundle and is
rejected as an unknown option — the desired orthogonality.

Remove the now-dead `edit_disabled` variable; every reader switches to
`edit_mode`.

### 2. Thread `edit_mode` through the gate handlers

- In `handle_human_gate` (`bin/gtd:352-387`): replace
  `if [[ "$edit_disabled" == 1 ]]` with `if [[ "$edit_mode" == "never" ]]`.
  `auto` and `force` take the identical editor-opening path (no branch needed
  between them here).
- In the main loop's `"message"` branch and the opening move, same substitution.

### 3. Opening move: honour `force` at a non-human rest + `--once`

Rework the opening-move block (`bin/gtd:460-479`):

- Parse `kind` (already) plus `state`/`actor` from `peek_json`.
- **`force` at a non-`message` rest:** emit one honest line via
  `emit_action "$M_HUMAN"` — e.g.
  `--edit: <state> is a <actor> turn, not a human gate — resuming without an edit`
  — and do **not** step (fall through to the loop).
- **`message` rest:** unchanged dispatch (`never` → silent `gtd step human`;
  else → `handle_human_gate`), then, if `once`, `exit 0` (the gate was the one
  beat). `handle_human_gate` already exits on halt/refusal; it only returns on a
  captured commit, so the `once` exit sits right after it (and after the
  `never`-branch's successful silent step).

### 4. `--once`: exit after one beat in the `while` body

Add `[[ "$once" == 1 ]] && exit 0` at each "beat completed, would otherwise
loop" point:

- `"message"` branch: after `handle_human_gate "$next_json"` returns (before
  `continue`).
- `"script"` branch: after `report_commits "$head_before"` succeeds (progress
  made) — before resetting `prev_*` and `continue`. The zero-commit path already
  `exit 0`s (settle), so no change there.
- `"prompt"` branch: after the final `report_commits "$head_before" || true`
  (the end of the loop body). One agent prompt + validate gate + step = one
  beat.

`--once` never interacts with stall detection (only one iteration runs) or the
validate-gate retry loop (that's within a single beat and still runs to its
cap).

## Documentation (keep in lockstep — global rule: reflect every change in docs)

- **`docs/cli.md`**
  - Options block (`cli.md:64-73`): add `--edit`/`-e` and `--once` lines
    alongside `--no-edit`, all tagged "(bare gtd or gtd loop only)".
  - Rename/extend the `## --no-edit` section to cover the whole editor axis (or
    add sibling `## --edit` + `## --once` sections): three values force/auto/
    never; `--edit` overrides `GTD_NO_EDIT`; `--edit`+`--no-edit` mutually
    exclusive; the honesty caveat at a non-human rest; `--once` = one beat.
  - `## gtd edit [path]` (`cli.md:437-469`): add a sentence framing it as
    non-looping plumbing and pointing at `--edit` for the loop-driving path.
- **`docs/loop.md`**: extend "Editing is on by default" to describe the
  three-value axis and `--edit` (incl. the non-human-rest notice); add a short
  "Single-stepping with `--once`" subsection defining one beat. Keep the
  embedded reference script honest — it doesn't implement these flags, so note
  they're `bin/gtd` additions on top of the reference (as `--no-edit` already
  is).
- **`skills/loop/SKILL.md`**: the "Halting on a human gate" section already
  documents `--no-edit`; add `--edit` (force, overrides `GTD_NO_EDIT`, honest
  non-gate notice) and a one-line `--once` mention. These _are_ part of the
  driver contract a hand-driver mirrors, so they belong here.
- **`README.md`**: the "Bare `gtd`" paragraph (`README.md:176-188`) mentions
  `--no-edit`; add `--edit` and `--once` in one clause each.

## e2e scenarios (AGENTS.md: composable Given steps, real setup in scenario text)

All new scenarios go in `tests/integration/features/gtd-loop.feature` (the
bundled `@live` driver suite). Reuse existing Given steps (`a gtd config file`,
`a stub agent script`, `a commit ...`, `$EDITOR is a script ...`/`no-op script`,
`GTD_NO_EDIT is set to`, `I record the commit count`). One small step addition:

- `tests/integration/support/steps/gtd-loop.steps.ts`: add
  `When("I run bare gtd with {string}")` → `runBinGtd(world, value.split(" "))`,
  for readable flag scenarios (`I run bare gtd with "--edit --once"`).
  `gtd loop --flag` scenarios reuse the existing `I run {string} via gtd`
  (`"loop --edit"` → `bin/gtd loop --edit`).

Scenarios to add:

1. **`--edit` forces the editor even when `GTD_NO_EDIT` is set.** `GTD_NO_EDIT`
   = "1" + a fake editor that appends a REVIEW tick; at a `reviewing` human
   gate, `I run bare gtd with "--edit"` → editor was opened on `.gtd/REVIEW.md`
   and the loop drives to `done`. Proves `force` overrides the env `never`.
2. **`--edit` at a non-human rest resumes without opening the editor.** Machine
   rests at an agent `working` rest; fake editor appends "should never be seen".
   `I run bare gtd with "--edit"` → stdout contains the honest notice (`working`
   … `not a human gate`), the fake editor was not invoked, the build still
   proceeds.
3. **`-e` is accepted as `--edit`.** Same shape as (1) via
   `I run bare gtd with "-e"`.
4. **`gtd loop --edit` is recognized after `loop`.**
   `I run "loop --edit" via gtd` at a human gate opens the editor and drives.
5. **`--edit` and `--no-edit` together are a usage error.**
   `I run bare gtd with "--edit --no-edit"` → exit code 2, stderr contains
   "mutually exclusive", commit count unchanged.
6. **`--once` handles one human gate and stops.** idle(human)→working(agent)→…;
   fake editor advances idle. `I run bare gtd with "--once"` → the idle→working
   transition is captured (commit count increased by 1) but the agent's output
   file (`src/calc.ts`) does **not** exist and stdout does not contain the
   settle line. Proves it stopped after the gate beat.
7. **`--once` runs one agent turn and stops before the following check.**
   Machine rests at agent `working` (`gtd(agent): working` commit seeded); stub
   writes `src/calc.ts`. `I run bare gtd with "--once"` → `working → checking`
   transition rendered, `src/calc.ts` exists, but the `done` squash never
   happens (git log does not contain the done subject) and no settle line.
8. **`--edit --once` combine.** At a human gate: opens the editor, captures the
   one gate beat, exits without driving further.
9. **`gtd loop --once` recognized after `loop`.** Mirrors (7) via
   `I run "loop --once" via gtd`.
10. **`gtd --once extra` (stray non-flag) is a usage error.**
    `I run "--once extra" via gtd` → exit 2, stderr mentions the unexpected
    argument, commit count unchanged.

`STATES.md` needs no change (no template/engine change). No version/changelog
edit — releases are semantic-release-driven from the conventional commits.

## Order of work

1. `bin/gtd` parser + `edit_mode`/`once` threading (§1–4).
2. Add the `I run bare gtd with {string}` step; write the 10 scenarios.
3. Run `npm run build` (bundle) + the `@live` gtd-loop feature; iterate.
4. Docs: `docs/cli.md`, `docs/loop.md`, `skills/loop/SKILL.md`, `README.md`.
