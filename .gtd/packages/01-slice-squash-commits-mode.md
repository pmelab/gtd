# 01 — Slice-aware squash and `commits` mode

Mod-only: `claude/hooks/ship.ts`, its test, `claude/hooks/register.tsx`. **No
`src/` change.** Interfaces and call stacks: `.gtd/ARCHITECTURE.md` (package A).

## Requirements

**1. Read slices and per-slice messages from gtd, retire the summary regex**

- **Ranges come from `gtd slices --json`**
  (`{schema: 1, slices: [{name, base, tip, closed}]}`); **each slice's commit
  message prompt is `gtd summary --slice=<name>`** through `COMMIT_FORMAT`
- **The `summaryRange` regex over plain `gtd summary` prose is deleted**;
  process base = first slice's `base`, tip = last slice's `tip`
- **Last slice's tip ≠ HEAD refuses** ("something landed since")
- **Commits below the first slice's `base` (earlier `restart()` episodes) stay
  untouched** as their own commits — no detection, no refusal
- **Document not schema 1, unreadable, or otherwise invalid refuses, nothing
  changed**
- Cost trailers summed per slice range

**2. Refuse while any slice is open**

- **A slice with `closed: false` refuses, nothing changed, naming the slice**
  and the state from `gtd next --json=state`, keeping the words "still
  underway"; the `initial` check stays behind it
- **`gtd summary` non-zero = no process at HEAD: today's path unchanged**, no
  `gtd slices` call

**3. Single slice: unchanged**

- **One slice (implicit `main` included) ships exactly as today in every mode**:
  `reset --soft` + `git commit`, one branch, one PR

**5. `commits` mode**

- **≥ 2 landed slices: `<branch>` ends as one commit per slice, in slice order,
  one PR into the default branch**
- **Survives only a rebase merge.** Ship reads
  `gh repo view --json rebaseMergeAllowed`; **`false`, a failed read, or
  anything but `true` warns in the report and ships anyway** — never refuses.
  Read only when ≥ 2 slice commits land

**6. Mode setting**

- **`GTD_SHIP_MODE` from the session env; unset or empty = `stack`**
- **Any other value refuses before any git, gtd or gh call**, naming `stack` and
  `commits`
- Dry run previews per slice (this package: `commits` mode and single slice)

**7. `.gtd/`-only slices**

- **A slice with no diff outside `.gtd/` lands nothing of its own** — its range
  joins the next landed slice (the previous when last)
- **All slices empty: `git reset --hard <first base>`, as today**

**8. History ref before the squash**

- **`refs/gtd/history/<entry>` pushed once, before any `commit-tree` or
  `reset`**; a failed push changes nothing
- **Every slice commit carries `Gtd-History:`**

**9. Tests (this package's share)** — single-slice, `commits`, open slice,
invalid mode, empty slice, dry run per slice, rebase-merge warning.

## Tasks

### 1. `shipMode` and `GTD_SHIP_MODE` wiring

- [ ] `export type ShipMode = "stack" | "commits"`; `shipMode(raw)` returns
      `stack` for unset/empty, passes `stack`/`commits`, else `{ refusal }`
      naming both
- [ ] `ship(io, isDry, mode?)` — invalid mode refuses before branch, tree or gtd
      reads
- [ ] `register.tsx` `shipNow` passes `await $.env.get("GTD_SHIP_MODE")` as the
      third argument; `ShipIo` unchanged
- [ ] **Interim, untested, replaced by package 02: `stack` mode with ≥ 2 landed
      slices refuses before the history push, nothing changed**

Paths: `claude/hooks/ship.ts`, `claude/hooks/register.tsx`,
`claude/hooks/ship.test.ts`

### 2. `readSlices`

- [ ] `export type Slice = { name; base; tip; closed }`; `readSlices(stdout)`
      returns `Slice[]` or `{ refusal }`
- [ ] Refuses: invalid JSON, `schema !== 1`, empty/non-array `slices`, name not
      `/^[a-z][a-z0-9-]*$/` or repeated, hash not 40/64 lowercase hex,
      non-boolean `closed`, `base` ≠ previous `tip`
- [ ] Golden `src/wire/golden/1/slices.json` parses to one slice

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

### 3. Squash phase over slices

- [ ] `gtd summary` exit code only probes for a process; stdout unparsed
- [ ] `gtd slices --json` → `readSlices`; non-zero exit after a successful probe
      refuses with gtd's stderr
- [ ] Open-slice refusal, then `initial` check, then tip-equals-HEAD check
- [ ] Landed list via `git diff --quiet <base> <tip> -- :(exclude).gtd/`; empty
      ranges fold next (previous when last); none landed → `dropProcess`
- [ ] Per landed slice: `git log --format=%B%n <base>..<tip>` → `costTrailers`;
      `gtd summary --slice=<name>` + `COMMIT_FORMAT` → `io.complete` →
      `cleanReply`; empty reply refuses before the history push
- [ ] `historyRef` once; `Gtd-History:` on every slice message
- [ ] `summaryRange` and its module comment deleted; module comment says ship
      squashes per slice

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

### 4. Commit building and `commits` mode PR

- [ ] One landed slice: `git reset --soft <base>` +
      `git commit --cleanup=strip     -F -`, as today
- [ ] ≥ 2: per slice `git stripspace --strip-comments` →
      `git commit-tree <tip>^{tree} -p <prev>` (prev starts at the first base),
      then one `git reset --soft <top>`; no ref moves before every commit exists
- [ ] `commits` mode ≥ 2:
      `gh repo view --json rebaseMergeAllowed -q     .rebaseMergeAllowed`;
      warning line in the report unless `true`; then today's
      `pullRequest(<branch>)`
- [ ] Dry run prints each slice's message and the warning; no `commit-tree`,
      `reset`, `push`, `gh pr create|edit`

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

### 5. Existing tests adapted

- [ ] Every existing case passes with only `gtd slices --json` (one `main`
      slice) and `gtd summary --slice=main` added to the `feature` fixture
- [ ] The 64-hex summary-range case becomes a 64-hex slices case

Paths: `claude/hooks/ship.test.ts`

## Acceptance (unit, `claude/hooks/ship.test.ts`)

- [ ] `shipMode`: unset/empty → `stack`; `stack`, `commits` pass; `Stack`,
      `squash` refuse naming both
- [ ] Invalid `GTD_SHIP_MODE` refuses with no git, gtd or gh call
- [ ] Commit prompt = `gtd summary --slice=<name>` output + `COMMIT_FORMAT`;
      plain `gtd summary` stdout never reaches `complete`
- [ ] Unreadable slices JSON, `schema: 2`, non-zero `gtd slices` after a good
      probe each refuse with no `git reset|commit|push` or `gh` call
- [ ] Commits below the first `base` untouched: `reset --soft` and first
      `commit-tree` parent are that `base`, not the merge base
- [ ] Last tip ≠ HEAD refuses "something landed since"
- [ ] `closed: false` slice refuses naming it, nothing changed
- [ ] `gtd summary` non-zero: no `gtd slices` call, branch described as it
      stands
- [ ] One `main` slice: one commit via `reset --soft` + `git commit`, one
      `gh pr create` into main, under `stack`, `commits` and unset alike
- [ ] Two slices, second `.gtd/`-only: one commit whose tree is HEAD's, no slice
      branch
- [ ] Three slices, middle `.gtd/`-only: two commits, middle range's cost
      trailers summed into the third
- [ ] All slices `.gtd/`-only: `git reset --hard <first base>`, no turn, no
      history lookup
- [ ] `commits`, two slices: two `commit-tree` chained from the first base over
      each tip's tree, one `reset --soft` to top, one `gh pr create` from
      `<branch>` into main
- [ ] Each slice message carries only its own range's `Gtd-Cost:` sums plus the
      same `Gtd-History:`
- [ ] History ref pushed exactly once before first `commit-tree`/`reset`; failed
      or killed push → no `commit-tree`, `reset` or `gh` call
- [ ] `commits` with `rebaseMergeAllowed` `false` or `gh repo view` failing
      ships with the warning; `true` carries none
- [ ] `commits` dry run prints each message and the warning, no writes
- [ ] Empty commit-message turn for the second slice refuses before the history
      push
- [ ] `readSlices`: golden doc → one slice; refuses invalid JSON, `schema: 2`,
      empty `slices`, name `Foo` or `a/b`, repeated name, short or uppercase
      hash, `base` ≠ previous `tip`
- [ ] `npm test` green

## Tests

- unit: `claude/hooks/ship.test.ts`
