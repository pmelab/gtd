# 02 — `stack` mode, docs

Builds on package 01's slice commits. Mod-only: `claude/hooks/ship.ts`, its
test, `claude/hooks/assist.ts`, `docs/driver.md`, `README.md`. **No `src/`
change.** Interfaces and call stacks: `.gtd/ARCHITECTURE.md` (packages B, C).

## Requirements

**4. `stack` mode: one branch and one PR per slice**

- **Each landed slice is one squashed commit stacked on `<branch>`** (01 builds
  them)
- **Every slice but the last gets `<branch>-<slice name>` at its commit; the
  last keeps `<branch>`**. `refactor`, `feature` on `feat/x` → `feat/x-refactor`
  → main, `feat/x` → `feat/x-refactor`
- **Each PR targets the branch below; the first targets the default branch**
- Pushes follow `pushBranch`: set-upstream when new, `--force-with-lease` when
  rewritten
- **Each PR described from its own slice range only**, through the existing
  create / update / thrown-draft-rewrite paths
- **Open PR with the wrong base is retargeted** (`gh pr edit <n> --base`)
- **A `MERGED` or `CLOSED` slice PR refuses before the history push, nothing
  changed**, naming slice and PR
- **An existing `<branch>-<name>` (local or `origin/`) not named in
  `branch.<branch>.gtdStack` refuses before the history push**
- **Every PR above the first opens with `Stacked on #N — merge that first`; the
  lowest has none; re-applied on every update**, even on `NO-UPDATE`; no edit
  when already right
- Lower PR number from its `number` or `gh pr create` URL's `/pull/<n>`; an
  unreadable URL fails naming the slice before the upper PR is touched
- Plain `gh` only
- **Part-way failure keeps what landed; report names failed slice, step, slices
  already landed, and says `/gtd ship` resumes**
- **Resume: `branch.<branch>.gtdStack` (slice names bottom first) written right
  after the squash**; a re-run with no process at HEAD rebuilds the stack when
  each `refs/heads/<branch>-<name>` chains (`merge-base --is-ancestor`) to the
  next and to HEAD; else one log line, `git config --unset`, today's
  single-branch path. **Single-slice ship unsets it**

**6. Mode setting (dry-run share)** — `stack` dry run lists per slice its
message, branch, "would open into <base>" or "would refresh <url>", plus any
retarget; no write.

**9. Tests and docs (this package's share)**

- Tests: `stack`, wrong base retargeted, merged slice PR refused, dry run per
  slice, "Stacked on" on upper PRs only
- **`docs/driver.md` "Inside Claude Code" and the README describe
  `GTD_SHIP_MODE`, both modes, `<branch>-<slice>` naming and `commits`' rebase
  merge requirement**; drop "into one commit" wording

## Tasks

### 1. `stackLine` and `pushBranch(head)`

- [ ] `stackLine(body, below?)` strips one leading
      `Stacked on #<n> — merge that first` line plus its blank line; prepends a
      fresh one when `below` given
- [ ] `pushBranch(io, branch, head = "HEAD")` — ancestor check reads
      `merge-base --is-ancestor <head> origin/<branch>`; existing four cases
      unchanged

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

### 2. Stack ship (replaces 01's interim `stack` ≥ 2 refusal)

- [ ] `STACK_KEY(branch)` = `branch.${branch}.gtdStack`
- [ ] Before history push: branch-collision check and per-slice
      `gh pr view <branch> --json number,title,body,url,state,baseRefName` state
      check
- [ ] After `reset --soft <top>`:
      `git config --local <STACK_KEY> "<n1> … <nk>"`, then
      `git branch -f <b>-<name> <commit>` per upper slice
- [ ] Bottom first: `pushBranch(io, sliceBranch, commit)` → none: `createPr`
      (base lower branch or default) | thrown: rewrite | open: retarget when
      `baseRefName` wrong, `updatePr`, body through `stackLine`,
      `gh pr edit --body-file -` only when changed
- [ ] Writer prompt per PR logs only `<lower commit>..<commit>`
- [ ] Failure report: slice, step, landed slices, "`/gtd ship` resumes"
- [ ] Single-slice path: `git config --unset <STACK_KEY>`
- [ ] Stack dry run per slice, no writes

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

### 3. Resume

- [ ] No-process path, `stack` mode, `STACK_KEY` set and chain valid → stack PR
      loop over `<lower commit>..<commit>`, top = HEAD
- [ ] Invalid chain → one log line, unset, today's single-branch path

Paths: `claude/hooks/ship.ts`, `claude/hooks/ship.test.ts`

### 4. Docs and prompt wording

- [ ] `claude/hooks/assist.ts` finished-process prompt asks whether to squash
      the process and open its pull request(s), not "combine it into one commit"
- [ ] `docs/driver.md` "Inside Claude Code" `/gtd ship` bullet: `GTD_SHIP_MODE`
      (`stack` default, `commits`, anything else refused), one commit per slice,
      `<branch>-<slice>` branches each PR on the one below with "Stacked on #N",
      single slice unchanged, `.gtd/`-only slices land nothing, open slices
      refused, **`commits` needs rebase merge (warned, not refused; a squash
      merge still collapses it)**, resume by re-running; drop "squashes the
      finished process into one commit"
- [ ] `README.md` Claude Code paragraph and "Process history": "squash" without
      "into one commit", mention `GTD_SHIP_MODE`, link the driver doc;
      `Gtd-History:` on every slice commit
- [ ] No doc names a `src/*.ts` module or internal function (AGENTS.md)
- [ ] `docs/driver.md` "A complete minimal driver" heading and fence untouched
      (doc-tested)

Paths: `claude/hooks/assist.ts`, `docs/driver.md`, `README.md`

## Acceptance (unit, `claude/hooks/ship.test.ts`)

- [ ] `stack`, slices `refactor`, `feature` on `feat/x`:
      `git branch -f feat/x-refactor <c1>`, pushes bottom first,
      `gh pr create --head feat/x-refactor --base main`, then
      `--head feat/x --base feat/x-refactor`
- [ ] Each stacked PR's writer prompt logs only its own range (`<base>..<c1>`,
      `<c1>..<c2>`)
- [ ] Upper PR body opens `Stacked on #<lower> — merge that first`; lowest has
      none
- [ ] Open slice PR with `baseRefName` `main` that should be `feat/x-refactor`
      gets `gh pr edit <n> --base feat/x-refactor`
- [ ] Slice PR `MERGED` or `CLOSED` refuses before history push, naming slice
      and PR, nothing changed
- [ ] Existing `feat/x-refactor` (local or `origin/`) not in
      `branch.feat/x.gtdStack` refuses before history push
- [ ] Thrown draft on the upper slice branch rewritten with stack line, marked
      ready
- [ ] `NO-UPDATE` refresh still re-adds a missing stack line; an already-right
      line edits nothing
- [ ] Upper push failing after lower PR opened reports failed slice and step,
      keeps the squash; second run (no process, `gtdStack` set) refreshes lower,
      pushes and opens upper
- [ ] Recorded `gtdStack` no longer chaining to HEAD is unset; branch ships as
      today
- [ ] `stack` dry run lists per slice message, branch, "would open into <base>"
      or "would refresh <url>" plus any retarget; no write
- [ ] `stackLine`: prepends `Stacked on #7 — merge that first` + blank line;
      replaces a stale `#3` line; no `below` strips it
- [ ] `pushBranch` with `head`:
      `merge-base --is-ancestor <head>     origin/<branch>`; existing four cases
      pass without it
- [ ] Multi-slice stack ship writes
      `git config --local branch.feat/x.gtdStack "refactor feature"`;
      single-slice ship unsets it
- [ ] `npm test` green

## Tests

- unit: `claude/hooks/ship.test.ts`
