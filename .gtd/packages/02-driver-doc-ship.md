# 02 — Docs: `/gtd ship` bullet describes the fixed stacked ship

Chore. Concern 5 of `.gtd/ARCHITECTURE.md`. Depends on package 01: it describes
what 01 ships. Declares no tests; `driver-doc.feature` only extracts the "A
complete minimal driver" fence, which this package must not touch.

## Requirements

### 5. `docs/driver.md` matches the shipped stack behaviour

- **The merged/closed refusal offers `GTD_SHIP_MODE=commits` only for a lower
  slice's PR; a merged or closed top PR needs a renamed branch**
- **Squash-merging a lower stacked PR rewrites its commit, so the PR above shows
  the lower slice's changes again until rebased or resumed**; a rebase merge or
  merge commit keeps the stack clean
- **A commits-mode re-ship of a stacked branch retargets its PR to the default
  branch and leaves the lower slice PRs open — close them by hand**
- Prose names no `src/*.ts` module, internal function or private type
  (AGENTS.md)

## Tasks

### Task 1: Rewrite the `/gtd ship` bullet in `docs/driver.md`

Paths: `docs/driver.md`

- [ ] Merged/closed refusal sentence (~lines 396-399) fixed as above
- [ ] Squash-merge caveat added
- [ ] Stale lower PR caveat added
- [ ] One short clause each: a PR on a base that is not a slice branch keeps its
      base; a thrown draft in a stack is retargeted; a missing slice branch is
      rebuilt only at the commit the stack was built at, else the ship refuses
      and names the unset
- [ ] "A complete minimal driver" heading and its single fence untouched

### Task 2: Check README

Paths: `README.md`

- [ ] Line ~340 read against the fix; edited only if a sentence contradicts it

### Task 3: Gate

- [ ] `format:check` clean; `npm test` green (doc-tested driver section still
      extracts)
