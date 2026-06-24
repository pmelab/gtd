# Process Review Feedback

The review feedback has been captured and is injected below as a diff. Your only
job is to synthesize it into a fresh `TODO.md`.

## Interpret the injected diff

The injected diff (rendered by the edge below this prompt) is the **single
source of all feedback**. Read it as follows:

- **REVIEW.md prose hunks** — global feedback, comments, and observations that
  apply to the whole change or to named areas.
- **Source-file comment additions** — local, inline feedback on specific lines
  or functions.
- **Source-file code changes** — suggestions that illustrate intent. Do **not**
  apply them verbatim; treat them as hints, verify independently, and implement
  properly.

Reference file names and function names from the REVIEW.md explanations so each
task has enough context to act on without re-reading the diff.

## Synthesize `TODO.md`

Compose `TODO.md` in the project root as a clear, actionable list of tasks
derived from all the feedback above. Group related items where helpful.

Then normalize formatting:

```sh
node scripts/gtd.js format TODO.md
```

Use the same `scripts/gtd.js` path that was invoked to get this prompt.

## Commit

Stage and commit ONLY `TODO.md`:

```sh
git add TODO.md
git commit -m "docs(review): synthesize TODO.md from review feedback"
```

Do not run any other git work — no revert, no record commit, no close commit.

## Recovery

If you lose the injected diff, recover it with:

```sh
git show <record-sha>
```

The edge substitutes the actual record SHA for `<record-sha>` when it renders
this prompt.
