# Requirements

Implement pmelab/gtd#382: **`/gtd ship` lands each slice of a finished process
separately**, picked by the driver setting `GTD_SHIP_MODE=stack|commits`
(default `stack`). gtd itself stays agnostic — this is mod-only work in the
`claude/` ship hook, its tests, `docs/driver.md` and the README. Its
dependencies #379 (`gtd slices`) and #380 (`gtd summary --slice`) are merged.

The human's sketch also **deleted all three `## Deferred review notes` sections
from `.gtd/TODO.md`** (note-1 `runSummaryCommand` doc comment, note-2
history-list scenario, note-3 garbled-flag stdout assertion). **They are
dropped, not in scope.**

## Open Questions

### Should stacked pull requests point at each other?

In `stack` mode a reviewer opening the feature PR sees only its base branch
name. The fork is whether ship writes the stack relationship into the PR bodies.

- [ ] No link — the base branch says it
  - nothing extra in any description
  - reviewer must infer order from `<branch>-refactor` as base
- [ ] Feature PR names the PR it stacks on
  - one line like "Stacked on #N — merge that first" above the description
  - lower PR knows nothing of the one above
- [ ] Both directions — each PR lists the whole stack, its own entry marked
  - reviewer sees order and position from any PR
  - every ship must re-edit every PR in the stack when one is created
  - more `gh pr edit` calls that can fail mid-way
- [ ] _your answer_

### What does `commits` mode do about a repo that cannot rebase-merge?

`commits` mode only survives a rebase merge; a squash merge collapses the slice
commits back into one. The fork is how hard ship guards that.

- [ ] Document it only
  - no extra `gh` call
  - a squash merge silently loses the per-slice commits
- [ ] Warn when the repo disallows rebase merge, ship anyway
  - one `gh repo view` read of the allowed merge methods
  - the report line tells the human before the PR is merged
- [ ] Refuse to ship when the repo disallows rebase merge
  - nothing pushed; human switches to `stack` or changes repo settings
  - a rebase-capable repo that merges by squash by habit still slips through
- [ ] _your answer_

## 1. Read slices and per-slice messages from gtd, retire the summary regex (TECHNICAL)

- **Ranges come from `gtd slices --json`**
  (`{schema: 1, slices: [{name, base, tip, closed}]}`); **each slice's commit
  message prompt comes from `gtd summary --slice <name>`**, fed through the
  existing commit-format turn
- **Delete the `git log <a>..<b>` regex over plain `gtd summary` prose**; the
  process base is the first slice's `base`, the tip the last slice's `tip`
- **The last slice's tip must equal HEAD**, else refuse as today ("something
  landed since")
- **A `restart()` episode boundary leaves earlier episodes' commits outside
  every slice** — `gtd slices` lists only the current episode. Fold commits
  between the process start and the first slice's base into the first slice, or
  refuse; pick one in architecture, never squash them away silently
- Check `schema === 1`; an unreadable or other-schema document refuses the ship,
  nothing changed
- Cost trailers are summed per slice range, not per process

## 2. Refuse while any slice is open (PRODUCT)

- **Any slice with `closed: false` refuses the ship**, nothing changed, naming
  the open slice — alongside the existing "process still underway" refusal
- No process at HEAD keeps today's behaviour: nothing squashed, branch described
  as it stands

## 3. Single slice: unchanged (PRODUCT)

- **One slice (including the implicit `main`) ships exactly as today in both
  modes**: one squash commit, one branch, one PR, `GTD_SHIP_MODE` ignored
- Existing `ship.test.ts` cases keep passing unmodified apart from the faked
  `gtd slices`/`gtd summary --slice` calls they now need

## 4. `stack` mode: one branch and one PR per slice (PRODUCT)

- **Each slice becomes one squashed commit, stacked in slice order on
  `<branch>`** — local `<branch>` ends as N commits, one per slice
- **Every slice but the last gets its own branch `<branch>-<slice name>`**
  pointing at that slice's commit; **the last slice keeps `<branch>`**. Two
  slices `refactor`, `feature` give `<branch>-refactor` → default branch and
  `<branch>` → `<branch>-refactor`
- **Each PR targets the branch below it; the first targets the default branch**
- Pushes per branch follow the existing `pushBranch` rule: set-upstream when
  new, `--force-with-lease` when rewritten
- Each PR is created, updated, or (thrown draft) rewritten through the existing
  create/update paths, described from **its own slice's commits only**
- **An existing PR on a slice branch with the wrong base is retargeted**
  (`gh pr edit --base`) — a thrown draft or an earlier single-slice ship targets
  the default branch
- **A slice PR that is merged or closed refuses the ship**, as today's "is
  MERGED, not open"
- Plain `gh` only — no stacking tool
- A failure part-way keeps whatever already landed; the report names the failed
  slice and step, and `/gtd ship` again resumes on the squashed branch

## 5. `commits` mode: one branch, one PR, one commit per slice (PRODUCT)

- **`<branch>` ends as one squashed commit per slice, in slice order; one PR
  into the default branch** describes all of them
- **Survives only a rebase merge** — a squash merge collapses them (guard: see
  Open Questions)

## 6. Mode setting (PRODUCT)

- **`GTD_SHIP_MODE` read from the session env**, as the mod reads
  `GTD_CODERMODEL`; unset or empty means `stack`
- **Any other value refuses the ship**, naming `stack` and `commits`, nothing
  changed
- Dry run (`/gtd ship -n`) previews per slice: its message, its branch, and its
  PR create/refresh and base

## 7. Slices with nothing outside `.gtd/` (PRODUCT)

- **A slice whose diff outside `.gtd/` is empty lands no commit, branch or PR**
  — its `.gtd/` churn folds into the next slice (the previous one when last)
- **All slices empty: drop the process, as today**

## 8. History ref before the squash (TECHNICAL)

- **`refs/gtd/history/<entry>` is still pushed before any reset**, once per
  ship; a failed push still squashes nothing
- **Every slice commit carries the `Gtd-History:` trailer**

## 9. Tests and docs (TECHNICAL)

- **`claude/hooks/ship.test.ts` covers `stack`, `commits` and single-slice**,
  plus: open slice refused, invalid mode refused, empty slice skipped, wrong PR
  base retargeted, merged slice PR refused, dry run per slice
- **`docs/driver.md` "Inside Claude Code" and the README** describe
  `GTD_SHIP_MODE`, both modes, the `<branch>-<slice>` naming, and the
  `commits`-mode merge requirement; drop "squash it into one commit" wording
  where it is no longer always true
- No `src/` change; no new `@inmem` cucumber scenario needed unless architecture
  finds a gtd-side gap

## Answered Questions

### How are branches named when a process has more than two slices?

`<branch>-<slice name>` for every slice but the last, which keeps `<branch>`:
the issue's `<branch>-refactor` generalised, and slice names are already unique,
branch-safe (`/^[a-z][a-z0-9-]*$/`).

### Does stack mode retarget an existing PR whose base is wrong?

Yes — without it the feature PR shows the refactor's diff twice; the only
existing PR on `<branch>` today targets the default branch by construction.

### What happens when a lower slice's PR is already merged or closed?

Ship refuses, as it does today for a non-open PR; managing a half-merged stack
is out of scope for #382.

### Which slice commits carry the `Gtd-History:` trailer?

All of them — no gtd code reads the trailer, and any commit should lead back to
the run.

### What does an invalid `GTD_SHIP_MODE` do?

Refuses, naming the valid values; silently falling back to `stack` would open
PRs the human did not ask for.

### What happens to a slice that changed only `.gtd/`?

It lands nothing of its own: an empty PR or commit is noise, and the
whole-process rule already drops `.gtd/`-only work.

### Does the mode reach the bash driver or `gtd loop`?

No — the issue scopes it to `/gtd ship`; gtd stays agnostic and other drivers
keep squashing via plain `gtd summary`.
