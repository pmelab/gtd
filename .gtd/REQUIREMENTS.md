# Requirements

Implement pmelab/gtd#381: on the naive-pass path (`GTD_FLAG_NAIVE_PASS=1`), a
`refactor-first` verdict splits the process into two separately reviewed slices
— `refactor`, then `feature`. Sketch: the one-line `.gtd/TODO.md` directive in
`0e41f1ad`. `slice(name, fn)` (#385) is already on this branch. **Step names and
order are Stable: ships as `feat!` with a literal `BREAKING CHANGE:` footer**
(`refactor!`/a bare `!` cuts no release).

## 1. Slices on the naive path (PRODUCT)

```text
design → naive pass → seam.judge
  refactor-first:
    slice("refactor"): refactor.* → refactor.build.quality.<lens> → refactor.build.review.*
    slice("feature"):  implement.* → build.quality.<lens> → build.review.*
  land / overrule at seam.steer / seam.by-hand:
    slice("feature"):  implement.* → build.quality.<lens> → build.review.*
```

- **Every naive-path verdict wraps implement + review in `slice("feature")`**;
  `gtd slices` shows `feature` for the feature work whatever the verdict
- **Only `refactor-first` adds `slice("refactor")` ahead of it**
- **Default path (naive pass off) unchanged**: no `slice()` call, one implicit
  `main` slice
- **`seam.approve` is removed**: the refactor review's sign-off commit is the
  approval record — **no `Gtd-Approved:` trailer on the refactor-first path any
  more**
- **Gates on `refactor-first`: design, refactor review, feature review = 3**; on
  `land`: design, feature review = 2; default path unchanged at 3
- Design, naive-pass and judge commits before the first slice fold into the
  first slice (slice gap rule): `refactor` on `refactor-first`, `feature`
  otherwise

## 2. Refactor review and its feedback loop (PRODUCT)

- **Step names: the refactor tail nests under `refactor` —
  `refactor.build.review.*`, `refactor.build.quality.<lens>`**; the feature tail
  keeps `build.review.*` / `build.quality.<lens>` on every path
- **`skills` keys are per full scope name**: a `build.review` or
  `build.quality.<lens>` entry does not reach the refactor scopes; they need
  their own entries, and ship with the same default skills as their feature
  counterparts
- **Refactor review covers the refactor slice's commits only**
- Same review flow as the feature review: questions answered in place, nits
  fixed, could-notes deferred to `.gtd/TODO.md`, edits loop
- **An edit note re-runs the refactor, never a re-plan**, under the same guards:
  stray paths only, no new or added flag reads, no test file touched
- **Quality-lap fixes, fix-check turns and nit fixes in the refactor slice run
  under those guards too**
- A note asking for a change outside the strays is refused by the guard; the way
  out is abandon and restart
- The human's code edits at the refactor review are re-unwound, as at the
  feature review

## 3. Feature review and its feedback loop (PRODUCT)

- **Feature review covers the feature slice only** — on `refactor-first`,
  everything since the refactor sign-off
- **Once judged, every feature feedback round is design → implement, on every
  verdict**: `seam.naive` and `seam.judge` never re-run (today they do after
  `land`)
- **Risk: a seam a re-plan turns up is built unjudged and unrefactored**; a
  wrong refactor or a missing one means abandon and restart
- The re-plan loop sits inside `slice("feature")` (a loop must sit inside its
  slice)

## 4. No test file touched by the refactor (TECHNICAL)

- **A refactor turn (building, fix, quality fix, nit) that changes a test file
  is refused at `gtd land`**, even when the file is a stray — today's package
  rule "a test file only when it is one of them" goes
- Refactor package text and prompts drop that exception

## 5. `refactorQualityReviews` setting (PRODUCT)

- **New process setting `refactorQualityReviews`, default
  `correctness, ponytail-review, conventions`**: the lenses of the refactor
  slice's quality lap (`refactor.build.quality.<lens>`); `qualityReviews` keeps
  driving the feature slice
- Settable like `qualityReviews`: factory option, `GTD_REFACTORQUALITYREVIEWS`;
  blank runs no refactor lap

## 6. Tests (TECHNICAL)

- **`@inmem` scenarios**: refactor review sign-off then feature review; refactor
  feedback loop; feature feedback skips naive pass and judge after both
  `refactor-first` and `land`; a refactor turn touching a test file is refused
- Update `src/workflows/feature/refactor-first.feature` (step paths
  `refactor.build.*`, commit subjects, no `Gtd-Approved:` assertion on
  `seam.approve`) and `seam.feature`
- Assert `gtd slices` lists `refactor` then `feature` on `refactor-first`, and
  `feature` alone on `land`
- Unit tests beside `src/workflows/feature/` for the new flow shape

## 7. Docs (TECHNICAL)

- **SDLC.md**: gate counts (naive path 2, or 3 on `refactor-first`), gate table
  (drop `seam.approve` row, add "refactor review sign-off" row), fixture list,
  "What stops a landing" (two reviews now split the full diff)
- **`docs/configuration.md`**: the naive-pass path list, `seam.approve` removed
  from scope/step lists, `refactor.build.*` scopes and their `skills` keys,
  `refactorQualityReviews` under the bundled workflows' settings, refactor
  package rules
- **README**: naive-pass mention and settings

## Answered Questions

### Are the two deferred review notes formerly in `.gtd/TODO.md` in scope?

No — the human's sketch replaced them; their removal drops them.

### Does the refactor review use the full review flow (triage, nits, defer)?

Yes — the issue names it a review like the feature one; only the edit route
differs (re-run refactor, not re-plan).

### What happens when a refactor review note needs a path outside the strays?

The guard refuses it; the issue settles it: a wrong refactor means abandon and
restart.

### What are the refactor review's step names?

The refactor tail nests under `refactor` (`refactor.build.review.*`,
`refactor.build.quality.<lens>`); the feature tail keeps `build.review.*` on
every path, so the default path and the feature review's names are untouched.

### What records the refactor approval once `seam.approve` is gone?

The refactor review's sign-off commit, like the feature review's; no
`Gtd-Approved:` trailer on the refactor-first path.

### Which slices does the naive path record when the judge rules `land`?

Every naive-path verdict wraps implement + review in `slice("feature")`; the
default path keeps the implicit `main`.

### Does feature review feedback re-run the naive pass and judge after a `land` verdict?

No — once judged, every feature feedback round is design → implement, on every
verdict.

### What skills do the new `refactor.build.*` scopes carry by default?

The same defaults as their `build.*` counterparts; `skills` keys are per full
scope name, so they get their own addressable entries — the answer to the naming
question implies it, and nothing in the issue asks for different lenses' skills.
