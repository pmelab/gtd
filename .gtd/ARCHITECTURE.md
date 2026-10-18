# Architecture

Mod-only: `claude/hooks/ship.ts` learns slices, `register.tsx` hands it
`GTD_SHIP_MODE`, docs follow. **No `src/` change** — gtd already gives every
range ship needs.

Three packages, built in order:

- **A — slice-aware squash and `commits` mode** (concerns 1, 2, 3, 5, 6, 7, 8):
  read and validate `gtd slices --json`, fold empty slices, one squashed commit
  per landed slice, history ref once, mode parsing, `commits`-mode warning, dry
  run per slice
- **B — `stack` mode** (concern 4): consumes A's squashed slice commits; slice
  branches, per-slice PRs, retarget, "Stacked on" line, resume after a part-way
  failure
- **C — docs** (concern 9): `docs/driver.md`, `README.md`, the finished-process
  prompt wording in `claude/hooks/assist.ts`

## Open Questions

### What does ship do with commits a `restart()` episode boundary leaves below the first slice?

**gtd already treats a `restart()` as a new process**: the first slice's `base`
is the process's start parent, the same base plain `gtd summary` names and
today's ship squashes from — so today's ship already leaves an earlier episode's
commits below the squash, untouched. The requirement asks for fold or refuse;
ship cannot see where the earlier episode starts without guessing from commit
subjects.

- [ ] Leave them as their own commits below the first slice, as today
  - no detection code, no new refusal; a single-slice ship stays exactly as
    today (concern 3), including two unshipped processes on one branch
  - drops the requirement's "fold or refuse" — those `gtd(...)` step commits
    stay in the first PR's diff, outside its description
- [ ] Refuse when the commit directly under the first slice is a gtd step commit
      (subject `gtd(human|agent|check|judge): …`)
  - one `git log -1 --format=%s <base>` read, nothing changed on refusal
  - also refuses an ordinary second unshipped process on the branch, which ships
    today — a regression of concern 3, with no way out but a manual squash
- [ ] Fold the contiguous run of gtd step commits directly under the first slice
      into the first slice
  - walks first-parent from `base` down to the merge base while subjects match
    `gtd(...)`; the first slice's commit and cost trailers widen to cover them
  - the commit message still comes from `gtd summary --slice` and describes only
    the current episode; the folded episode's own history ref is not pushed, so
    its `Gtd-History:` pointer is lost
  - also folds a second unshipped bundled-workflow process into the first slice
    — changes concern 3's "exactly as today"
- [ ] _your answer_

## Interfaces

```ts
// claude/hooks/ship.ts

export type ShipMode = "stack" | "commits"

/** Unset or empty is `stack`; any other value is the refusal text naming both modes. */
export function shipMode(
  raw: string | undefined,
): ShipMode | { refusal: string }

/** `mode` is the raw `GTD_SHIP_MODE`; omitted means `stack`. Refuses an invalid one before any git call. */
export async function ship(
  io: ShipIo,
  isDry: boolean,
  mode?: string,
): Promise<Shipped>

export type Slice = { name: string; base: string; tip: string; closed: boolean }

/**
 * Parses `gtd slices --json` stdout. Refusal text when: not JSON, `schema !== 1`,
 * `slices` not a non-empty array, a name not `/^[a-z][a-z0-9-]*$/` or repeated,
 * a base/tip not 40 or 64 lowercase hex, `closed` not boolean, or a slice's
 * `base` not the previous slice's `tip`.
 */
export function readSlices(stdout: string): Slice[] | { refusal: string }

/**
 * The PR body with its stack line normalised: one leading
 * `Stacked on #<n> — merge that first` line (and the blank line after it) is
 * removed, and when `below` is given a fresh one is prepended.
 */
export function stackLine(body: string, below?: number): string

/** `head` (default "HEAD") is what the branch must hold; slice branches pass their slice commit. */
export async function pushBranch(
  io: ShipIo,
  branch: string,
  head?: string,
): Promise<string | undefined>

/** Local git config key holding the stack ship built: slice names, bottom first, space-separated. */
export const STACK_KEY: (branch: string) => string // `branch.${branch}.gtdStack`
```

```ts
// claude/hooks/register.tsx — shipNow
ship(shipIo($), isDry, await $.env.get("GTD_SHIP_MODE"))
```

Contracts ship now relies on (all read through `io.run`, faked in tests):

- `gtd summary` — **exit code only**: non-zero means no process at HEAD (today's
  probe, kept so concern 2's no-process path is unchanged); its stdout is no
  longer parsed
- `gtd slices --json` — `{schema: 1, slices: [{name, base, tip, closed}]}`;
  non-zero exit after a successful `gtd summary` refuses with gtd's stderr
- `gtd summary --slice=<name>` — the commit-message prompt for one slice, fed
  through `COMMIT_FORMAT` as today
- `git commit-tree <tip>^{tree} -p <parent> -F -` — builds a multi-slice commit;
  `git stripspace --strip-comments` stands in for `--cleanup=strip`
- `gh pr view <branch> --json number,title,body,url,state,baseRefName` — one
  slice branch's PR (stack mode only; single slice keeps bare `gh pr view`)
- `gh pr edit <n> --base <branch>` — retarget
- `gh repo view --json rebaseMergeAllowed -q .rebaseMergeAllowed` — `true` means
  allowed; `false`, non-zero exit or anything else warns

## Call Stacks

Mode and validation (A):

- `/gtd ship` | `mcp__gtd__ship` → `register.tsx shipNow` →
  `$.env.get("GTD_SHIP_MODE")` → `ship(io, isDry, mode)`
- `ship` → `shipMode` → refusal returned before branch, tree or gtd reads
- `ship` → branch / default-branch / dirty-tree checks (unchanged) → squash
  phase

Squash phase (A):

- squash → `gtd summary` exit ≠ 0 → no-process path (stack: B's resume check;
  else today's `pullRequest`)
- squash → `gtd slices --json` → `readSlices` → refusal | slices
- squash → first slice with `closed: false` → refuse naming it and
  `gtd next --json=state` ("still underway")
- squash → `gtd next --json=initial` ≠ true → today's "still underway" refusal
- squash → last `tip` ≠ `git rev-parse HEAD` → "something landed since"
- squash → per slice `git diff --quiet <base> <tip> -- :(exclude).gtd/` → landed
  list (empty slice's range joins the next landed slice, or the previous when
  last)
- squash → no landed slice → `dropProcess` (unchanged,
  `git reset --hard <first base>`)
- squash → per landed slice: `git log --format=%B%n <base>..<tip>` →
  `costTrailers`; `gtd summary --slice=<name>` →
  `io.complete(prompt + COMMIT_FORMAT)` → `cleanReply`
- squash → `historyRef(io, HEAD)` once → `Gtd-History:` on every slice message
- squash (dry) → preview per slice → return
- squash → history push once (unchanged) → refusal leaves everything as it was

Commit building (A):

- one landed slice → `git reset --soft <base>` →
  `git commit --cleanup=strip -F -` (unchanged) →
  `git config --unset branch.<b>.gtdStack`
- ≥ 2 landed slices → per slice `git stripspace --strip-comments` →
  `git commit-tree <tip>^{tree} -p <prev>` (prev starts at the first base) → one
  `git reset --soft <top>`
- `commits` mode, ≥ 2 slices → `gh repo view … rebaseMergeAllowed` → warning
  line kept for the report → today's `pullRequest(<branch>)`

Stack mode (B), ≥ 2 landed slices:

- before history push: per upper slice, `refs/heads/<b>-<name>` or
  `origin/<b>-<name>` existing and not named in `branch.<b>.gtdStack` → refuse,
  nothing changed
- before history push: per slice `gh pr view <slice branch> …` → state ≠ OPEN →
  refuse naming slice and PR
- after `reset --soft <top>` →
  `git config --local branch.<b>.gtdStack "<n1> … <nk>"` → per upper slice
  `git branch -f <b>-<name> <commit>`
- per slice, bottom first → `pushBranch(io, sliceBranch, commit)` → PR: none →
  `createPr` (base: lower slice branch or default branch) | thrown → `createPr`
  rewrite | open → `gh pr edit --base` when `baseRefName` wrong → `updatePr` →
  body through `stackLine(body, lowerNumber)`, `gh pr edit --body-file -` when
  it changed
- any step fails → report names slice and step, lists slices already landed,
  says `/gtd ship` resumes

Resume (B):

- no-process path, stack mode, `branch.<b>.gtdStack` set → each upper
  `refs/heads/<b>-<name>` exists and is `merge-base --is-ancestor` of the next
  and of HEAD → stack PR loop over `<lower commit>..<commit>` ranges, top slice
  = HEAD
- record invalid → one log line, `git config --unset`, today's single-branch
  path

## E2E Scenarios

No e2e change. The mod has no cucumber tier and gtd's CLI is untouched; the
scripted-io tests in `claude/hooks/ship.test.ts` are ship's acceptance tests.

## Unit Tests

### shipMode

- unit: claude/hooks/ship.test.ts — unset and empty read as `stack`; `stack` and
  `commits` pass through (covers 6)
- unit: claude/hooks/ship.test.ts — any other value (`Stack`, `squash`) returns
  a refusal naming `stack` and `commits` (covers 6)

### ship

- unit: claude/hooks/ship.test.ts — every existing case passes with only
  `gtd slices --json` (one `main` slice) and `gtd summary --slice=main` added to
  the `feature` fixture; the 64-hex summary-range case becomes a 64-hex slices
  case (covers 3, 9)
- unit: claude/hooks/ship.test.ts — an invalid `GTD_SHIP_MODE` refuses naming
  both modes, with no git, gtd or gh call made (covers 6, 9)
- unit: claude/hooks/ship.test.ts — the commit-message prompt is
  `gtd summary --slice=<name>` output plus `COMMIT_FORMAT`; plain `gtd summary`
  stdout is never sent to `complete` (covers 1)
- unit: claude/hooks/ship.test.ts — unreadable slices JSON, `schema: 2`, and a
  non-zero `gtd slices` after a successful `gtd summary` each refuse with no
  `git reset|commit|push` or `gh` call (covers 1)
- unit: claude/hooks/ship.test.ts — last slice tip ≠ HEAD refuses "something
  landed since" (covers 1)
- unit: claude/hooks/ship.test.ts — a slice with `closed: false` refuses naming
  that slice, nothing changed (covers 2, 9)
- unit: claude/hooks/ship.test.ts — `gtd summary` non-zero: no `gtd slices`
  call, branch described as it stands (covers 2)
- unit: claude/hooks/ship.test.ts — one `main` slice ships one commit via
  `reset --soft` + `git commit`, one `gh pr create` into main, under `stack`,
  `commits` and unset mode alike (covers 3, 9)
- unit: claude/hooks/ship.test.ts — two slices whose second only touched `.gtd/`
  ship as single-slice: one commit whose tree is HEAD's, no slice branch (covers
  7, 9)
- unit: claude/hooks/ship.test.ts — three slices, middle one `.gtd/`-only: two
  commits, the middle range's cost trailers summed into the third slice's commit
  (covers 7)
- unit: claude/hooks/ship.test.ts — every slice `.gtd/`-only:
  `git reset --hard <first base>`, no turn, no history lookup (covers 7)
- unit: claude/hooks/ship.test.ts — `commits` mode, two slices: two
  `commit-tree` calls chained from the first base, each over its slice tip's
  tree, one `reset --soft` to the top, one `gh pr create` from `<branch>` into
  main (covers 5, 9)
- unit: claude/hooks/ship.test.ts — each slice commit's message carries only its
  own range's `Gtd-Cost:` sums plus the same `Gtd-History:` trailer (covers
  1, 8)
- unit: claude/hooks/ship.test.ts — the history ref is pushed exactly once,
  before the first `commit-tree` and `reset`; a failed or killed push leaves no
  `commit-tree`, `reset` or `gh` call (covers 8)
- unit: claude/hooks/ship.test.ts — `commits` mode with `rebaseMergeAllowed`
  `false`, or `gh repo view` failing, ships and the report carries the
  rebase-merge warning; `true` carries none (covers 5, 9)
- unit: claude/hooks/ship.test.ts — `commits`-mode dry run prints each slice's
  message and the warning, and runs no `commit-tree`, `reset`, `push` or
  `gh pr create|edit` (covers 5, 6, 9)
- unit: claude/hooks/ship.test.ts — a commit-message turn returning nothing for
  the second slice refuses before the history push (covers 1)
- unit: claude/hooks/ship.test.ts — `stack` mode, slices `refactor`, `feature`
  on `feat/x`: `git branch -f feat/x-refactor <c1>`, pushes bottom first,
  `gh pr create --head feat/x-refactor --base main`, then
  `--head feat/x --base feat/x-refactor` (covers 4, 9)
- unit: claude/hooks/ship.test.ts — each stacked PR's writer prompt logs only
  its own slice range (`<base>..<c1>`, `<c1>..<c2>`) (covers 4)
- unit: claude/hooks/ship.test.ts — the upper PR's body opens with
  `Stacked on #<lower> — merge that first`; the lowest carries no such line
  (covers 4, 9)
- unit: claude/hooks/ship.test.ts — an open slice PR whose `baseRefName` is
  `main` but should be `feat/x-refactor` gets
  `gh pr edit <n> --base feat/x-refactor` (covers 4, 9)
- unit: claude/hooks/ship.test.ts — a slice PR `MERGED` or `CLOSED` refuses
  before the history push, naming slice and PR, nothing changed (covers 4, 9)
- unit: claude/hooks/ship.test.ts — an existing `feat/x-refactor` (local or
  `origin/`) not named in `branch.feat/x.gtdStack` refuses before the history
  push (covers 4)
- unit: claude/hooks/ship.test.ts — a thrown draft on the upper slice branch is
  rewritten with the stack line and marked ready (covers 4)
- unit: claude/hooks/ship.test.ts — a refresh whose writer says `NO-UPDATE`
  still re-adds a missing stack line; one whose line is already right edits
  nothing (covers 4)
- unit: claude/hooks/ship.test.ts — the upper slice's push failing after the
  lower PR opened reports the failed slice and step, keeps the squash, and a
  second run (no process at HEAD, `gtdStack` recorded) resumes: lower PR
  refreshed, upper pushed and opened (covers 4)
- unit: claude/hooks/ship.test.ts — a recorded `gtdStack` whose branches no
  longer chain to HEAD is unset and the branch ships as today (covers 4)
- unit: claude/hooks/ship.test.ts — `stack` dry run lists per slice its message,
  branch, and "would open into <base>" or "would refresh <url>" plus any
  retarget, with no write (covers 4, 6, 9)

### readSlices

- unit: claude/hooks/ship.test.ts — the golden `src/wire/golden/1/slices.json`
  document parses to one slice (covers 1)
- unit: claude/hooks/ship.test.ts — refuses: invalid JSON, `schema: 2`, empty
  `slices`, a name `Foo` or `a/b`, a repeated name, a short or uppercase hash, a
  gap where `base` ≠ previous `tip` (covers 1)

### stackLine

- unit: claude/hooks/ship.test.ts — prepends `Stacked on #7 — merge that first`
  plus a blank line (covers 4)
- unit: claude/hooks/ship.test.ts — replaces a stale `#3` line instead of
  stacking a second; with no `below` it strips the line (covers 4)

### pushBranch

- unit: claude/hooks/ship.test.ts — with `head` given, the ancestor check reads
  `merge-base --is-ancestor <head> origin/<branch>`; the existing four cases
  pass unchanged without it (covers 4)

### STACK_KEY

- unit: claude/hooks/ship.test.ts — a multi-slice stack ship writes
  `git config --local branch.feat/x.gtdStack "refactor feature"`; a single-slice
  ship unsets it (covers 4, 3)

### Chores

- chore: claude/hooks/register.tsx — `shipNow` passes
  `await $.env.get("GTD_SHIP_MODE")` as `ship`'s third argument (covers 6)
- chore: claude/hooks/assist.ts — the finished-process prompt asks whether to
  squash the process and open its pull request(s), not "combine it into one
  commit" (covers 9)
- chore: docs/driver.md — "Inside Claude Code" `/gtd ship` bullet:
  `GTD_SHIP_MODE` (`stack` default, `commits`, anything else refused), one
  commit per slice, `<branch>-<slice>` branches with each PR on the one below
  and a "Stacked on #N" line, a single slice unchanged, `.gtd/`-only slices
  landing nothing, open slices refused, `commits` needing rebase merge (warned,
  not refused; a squash merge still collapses it), resume by re-running; drop
  "squashes the finished process into one commit" (covers 9)
- chore: README.md — the Claude Code paragraph and "Process history" say
  "squash" without "into one commit", mention `GTD_SHIP_MODE` and link to the
  driver doc; `Gtd-History:` lands on every slice commit (covers 9)
- chore: claude/hooks/ship.ts — module comment and the `summaryRange` regex
  deleted; the comment states ship squashes per slice (covers 1)

## Merged Concerns

### A — slice-aware squash and `commits` mode

Merged because 1, 2, 3, 5, 6, 7 and 8 all rewrite the same squash phase of
`claude/hooks/ship.ts`; 4 stays apart, consuming the slice commits A builds.

**1. Read slices and per-slice messages from gtd, retire the summary regex
(TECHNICAL)**

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

**2. Refuse while any slice is open (PRODUCT)**

- **Any slice with `closed: false` refuses the ship**, nothing changed, naming
  the open slice — alongside the existing "process still underway" refusal
- No process at HEAD keeps today's behaviour: nothing squashed, branch described
  as it stands

**3. Single slice: unchanged (PRODUCT)**

- **One slice (including the implicit `main`) ships exactly as today in both
  modes**: one squash commit, one branch, one PR, `GTD_SHIP_MODE` ignored
- Existing `ship.test.ts` cases keep passing unmodified apart from the faked
  `gtd slices`/`gtd summary --slice` calls they now need

**5. `commits` mode: one branch, one PR, one commit per slice (PRODUCT)**

- **`<branch>` ends as one squashed commit per slice, in slice order; one PR
  into the default branch** describes all of them
- **Survives only a rebase merge** — a squash merge collapses them
- **Ship reads the repo's allowed merge methods (`gh repo view`) and warns in
  its report when rebase merge is disallowed, then ships anyway**; a failed read
  warns too, never refuses. Dry run shows the same warning
- Docs still state the rebase-merge requirement — the warning cannot catch a
  rebase-capable repo merged by squash out of habit

**6. Mode setting (PRODUCT)**

- **`GTD_SHIP_MODE` read from the session env**, as the mod reads
  `GTD_CODERMODEL`; unset or empty means `stack`
- **Any other value refuses the ship**, naming `stack` and `commits`, nothing
  changed
- Dry run (`/gtd ship -n`) previews per slice: its message, its branch, and its
  PR create/refresh and base

**7. Slices with nothing outside `.gtd/` (PRODUCT)**

- **A slice whose diff outside `.gtd/` is empty lands no commit, branch or PR**
  — its `.gtd/` churn folds into the next slice (the previous one when last)
- **All slices empty: drop the process, as today**

**8. History ref before the squash (TECHNICAL)**

- **`refs/gtd/history/<entry>` is still pushed before any reset**, once per
  ship; a failed push still squashes nothing
- **Every slice commit carries the `Gtd-History:` trailer**

## Answered Questions

### How does ship tell "no process at HEAD" from a `gtd slices` refusal?

It keeps today's probe, `gtd summary`'s exit code, and ignores its stdout: the
no-process path stays byte-for-byte today's, and a `gtd slices` failure after
that probe is a real refusal (config drift, diverged replay), never a silent
"describe as it stands".

### How are two or more slice commits built?

`git commit-tree` per slice over that slice tip's tree, chained from the first
base, then one `git reset --soft` to the top: no ref moves until every commit
exists, so a failure part-way changes nothing. Hooks do not run, which is safe
because each tree is one the step commits already landed;
`git stripspace --strip-comments` replaces `--cleanup=strip`. A single slice
keeps today's `reset --soft` + `git commit`.

### How do `.gtd/`-only slices fold into a neighbour?

By range: an empty slice's range joins the next landed slice's (the previous
one's when last). Commits are tree snapshots, so the `.gtd/` churn rides along
with no extra step; cost trailers are summed over the widened range.

### Does a single slice use plain `gtd summary` or `gtd summary --slice=main`?

`--slice=<name>` for every slice, the single one included: one code path, and
the requirement allows the extra fake in existing tests. The `=` form avoids any
argv ambiguity; names are validated before use anyway.

### Does an open slice or the "still underway" check refuse first?

The open slice: its refusal names the slice and the state from
`gtd next --json=state` and keeps the words "still underway", so the existing
test's match holds; the `initial` check stays behind it as today.

### How is the `gtd slices` document validated?

At the boundary, fully: schema 1, non-empty array, names `/^[a-z][a-z0-9-]*$/`
and unique (they become branch names and argv), 40/64 lowercase hex hashes,
boolean `closed`, each `base` equal to the previous `tip`. Anything else refuses
before a write.

### Where does `GTD_SHIP_MODE` reach ship?

`register.tsx` reads it with `$.env.get` beside `GTD_CODERMODEL` and passes it
as `ship`'s optional third argument; `ShipIo` stays unchanged, so `doors` and
`handoff` fakes need no edit.

### When does `commits` mode read the merge settings?

Only when this ship lands two or more slice commits: one commit survives any
merge method, and a resumed ship cannot tell how many slices it holds.

### How does a re-run find a stack after a part-way failure?

A local git config value, `branch.<branch>.gtdStack`, written right after the
squash with the slice names bottom first. A re-run with no process at HEAD
rebuilds the stack from `refs/heads/<branch>-<name>` when each still chains to
HEAD; otherwise it unsets the value and ships the branch as today. Config, not a
commit trailer, keeps commit messages clean, matching `prSyncHead`.

### When are slice PR states checked?

Before the history push: every slice branch's `gh pr view` is a read, so a
merged or closed slice PR refuses with nothing changed instead of half-way
through the stack.

### What if `<branch>-<slice>` already exists?

Refuse before any write unless `branch.<branch>.gtdStack` names that slice:
`git branch -f` and `--force-with-lease` would otherwise overwrite a branch ship
never made.

### How does an upper PR learn the lower PR's number?

From the lower slice's PR, processed first: an existing PR's `number`, or the
`/pull/<n>` tail of `gh pr create`'s URL; an unreadable URL fails naming the
slice before the upper PR is touched.

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

### Should stacked pull requests point at each other?

Yes, one way: each PR above the first names the PR it stacks on ("Stacked on #N
— merge that first"); lower PRs know nothing of those above.

### What does `commits` mode do about a repo that cannot rebase-merge?

Warns in the ship report when the repo disallows rebase merge, and ships anyway.

### Are the deleted `## Deferred review notes` in scope?

No — the human's sketch deleted all three; they are dropped.
