# 05 — `refactorFirst` doc fix and naive-pass migration

Concerns 7, 8. Runs last: the replay test pins step order after packages 01–04.

## Requirements

### 7. Fix the stale `refactorFirst` doc

**`docs/configuration.md` says the shipped `feature` flow runs `refactorFirst`
only on the naive-pass path; it now runs `reviewedRefactor`.**

- Correct that sentence and every line in `### refactorFirst` that predates the
  review tail: the review tail's fix-check, quality-fix, risk-fix, nit-fix and
  describe turns are guarded and prompted with the same rules
- No `src/*.ts` module name in prose; exported API names are fine

### 8. Docs and breaking footer: `seamBuild` change, in-flight naive processes

**The `BREAKING CHANGE:` footer and docs mention only `seam.approve`; they miss
the `seamBuild` API change and in-flight naive-pass processes.**

- `seamBuild(tier)` became `seamBuild(base)`, returns `{ reference, base }`, no
  longer runs `implement` — a custom workflow must call `implement` itself
- **Determine by test which rests of an in-flight `GTD_FLAG_NAIVE_PASS` 28.0.0
  process still replay; document the exact set that must `gtd abandon`** (no
  migration code)
- Squash footer: `!` plus a literal `BREAKING CHANGE:` footer carrying both
  migrations (`docs/commits.md`)

## Tasks

### Task 1: Replay test for in-flight naive-pass trails

Paths: `src/workflows/feature/feature.test.ts`

- [ ] Forge the 28.0.0 naive-pass trail as `Gtd-Step:` commits, step sequence
      read off `main`'s naive-pass scenarios, one per rest: `design.*`,
      `seam.naive`, `seam.judge`, `seam.approve`, `refactor.*`, `implement.*`,
      `build.*` on each verdict, and after a feature feedback lap
- [ ] Pin for each rest whether `feature` replays to the same rest or fails
      replay; the failing set is the abandon set

### Task 2: `docs/configuration.md`

Paths: `docs/configuration.md`

- [ ] `### refactorFirst`: "runs `refactorFirst` only on the naive-pass path" →
      `reviewedRefactor`; review tail's five fix/describe turns listed as
      guarded and prompted with the same rules
- [ ] `**Upgrading:**` names both migrations (`seam.approve` removal;
      `seamBuild(tier)` → `seamBuild(base)` returning `{ reference, base }`,
      caller runs `implement`) and the exact abandon set from Task 1
- [ ] No `src/*.ts` module name in prose

### Task 3: README and PR body

Paths: `README.md`, PR #390

- [ ] README naive-pass paragraph mentions the abandon set — only if Task 1
      shows rests beyond `seam.approve` that must abandon
- [ ] `gh pr edit 390` body gains a `BREAKING CHANGE:` footer with both
      migrations, so the squash carries `!` plus the literal footer

## Tests

- unit: `src/workflows/feature/feature.test.ts`

Test cases:

- [ ] feature.test: forged 28.0.0 trail per rest pins replay-or-fail; failing
      set equals the documented abandon set
