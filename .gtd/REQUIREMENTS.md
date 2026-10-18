# Requirements: PR 401 review 3 — declared-tests guard follow-ups

## Open Questions

### What should the refusal tell a builder who created a test marked (unchanged)?

The marker promises the test already exists, so a test the build turn added
means decompose marked it wrongly. The builder cannot edit the package text, so
the fix it is told to make decides whether the turn can ever pass.

- [x] Name the broken promise and say to stop and leave it to a person
  - matches the build prompt's existing rule: "if the marker is wrong … stop and
    leave it to a person"
  - the turn stays refused until a human fixes the package
  - no bouncing between two refusals
- [ ] Tell it to delete the added test
  - mirrors the "revert them" / "restore them" wording
  - **risk: deleting it trips "missing from the tree" next turn — the builder
    ping-pongs between two refusals, a new #373-style loop**
- [ ] List it under the existing "missing from the tree" group, worded as
      "absent when the package started"
  - no new group; one message covers every marked test that never existed
  - less precise: hides that the turn wrote the file
- [ ] _your answer_

## Concerns

### 1. Refuse a build turn that adds a test marked (unchanged) — PRODUCT

**A build turn that creates a file the package marks `(unchanged)` is refused,
not only one that modifies or deletes it.** The marker promises an existing
test; a test the turn wrote breaks that promise. Today an added marked test
passes because it exists in the tree.

- Scope: **build turn only**; fix turns keep today's behaviour
- **The unmarked entry still wins** when a path is listed both marked and
  unmarked — that file is written by the package, adding it is fine
- The refusal gets its own wording (see the open question)
- The build prompt and README state the new rule: a marked test must exist
  before the turn, and the turn must not create, edit or delete it
- New `@inmem` scenario in `tests/integration/features/declared-tests.feature`:
  a build that adds a test marked (unchanged) is refused; unit cases beside the
  guard

### 2. Make the guard's turn parameter required — TECHNICAL

**`requireDeclaredTests` takes its turn (`"build"` | `"fix"`) with no default.**
Today it silently defaults to `"fix"`, the looser rule, so a new caller that
forgets it skips the build-only checks. Every caller and test passes it
explicitly.

### 3. List each refused path once — PRODUCT

**A path appears at most once in a refusal message.** Today a path declared
twice under `## Tests` is pushed twice and printed twice. Deduplicate within and
across groups; group order and wording otherwise unchanged. Unit test covers a
duplicated entry.

### 4. Drop the three deferred review notes — PRODUCT

**The deferred notes under `## Deferred review notes` (836985b, daed27f,
eda53bb) are dismissed, not built.** The human deleted all three in the same
edit that wrote this sketch; they belong to earlier, unrelated processes. They
leave `.gtd/TODO.md` with this process.

## Answered Questions

### Does the "added" refusal also apply to fix turns?

No — the sketch says "in the build turn"; fix turns may still touch a marked
test so a fix can repair what the package's code broke, as decided in 08eaee9.

### Which duplicates does "list each refused path once" cover?

Any repeat of one path anywhere in the message — a duplicated `## Tests` line is
the only way one path reaches the list twice, so a single dedupe settles it.

### Do the deleted deferred review notes get folded into this work?

No — deleting them alongside a narrowly scoped directive is a dismissal; they
concern unrelated code (CLI stdout test, `gtd history list`, a doc comment).
