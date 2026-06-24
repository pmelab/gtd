# Process Review Feedback

You are processing feedback from a code review session. The reviewer has
annotated `REVIEW.md` and may have directly edited source files to illustrate
changes.

## Step 1: Read REVIEW.md for Context

Read `REVIEW.md`. It contains:

- **Chunk titles and explanations** written by the tool that generated it —
  these describe what each diff chunk does; use them as context when
  interpreting feedback.
- **Base ref** (noted at the top as `<!-- base: … -->`) — the commit the review
  was based on. Record this full hash; you will need it in Steps 6–8.
- **Reviewer comments** — text the user added (inline or between chunks).
- **Checkboxes** — informational only; do not treat checked/unchecked as
  approval or rejection. Read all content regardless of checkbox state.

## Step 2: Read the Working Diff

Run `git diff` (and `git status` for untracked files) to see what the reviewer
changed during the session.

## Step 3: Interpret All Source Modifications as Feedback

Treat **every** modification to a source file as intentional reviewer feedback.
There is no marker convention — if the reviewer edited a file, that edit
expresses a desired change or demonstrates an issue. This includes any `!!`
comment lines added to source files — treat them as inline feedback hunks, not
as separately injected context.

Do not re-examine the original diff from the base ref. The explanations already
present in `REVIEW.md` provide sufficient context for understanding what each
chunk was about.

## Step 4: Collect All Feedback

All feedback comes from a single source: the diff of reference commit "x"
(recorded in Step 6, read back in Step 7). At this point, gather feedback from
two places visible in that diff:

1. **REVIEW.md comments** — any text the reviewer added to the file (inline
   notes, questions, suggestions written between or inside chunks).
2. **Source file edits** — every hunk in any source file, including lines
   containing `!!` markers. Describe what was changed and infer the reviewer's
   intent from the surrounding REVIEW.md explanation.

Do not reference any injected context section for `!!` comments — they appear
as ordinary diff hunks and are treated identically to other source edits.

## Step 5: Commit Raw Feedback as Reference Commit "x"

Before synthesizing, preserve the reviewer's entire working tree as a dedicated
commit. This keeps the annotated `REVIEW.md` (with checkboxes), all source
edits, any untracked files added during the session, and any `!!` markers in
git history — exactly as the reviewer left them.

Use the full hash from the `<!-- base: … -->` comment you recorded in Step 1 as
`<base>`. Then run:

```sh
git add -A
git commit -m "docs(review): record raw feedback for <base>"
```

Replace `<base>` with the actual base ref. Do not modify any file content —
commit verbatim. Call this commit "x"; you will reference it in Steps 6 and 7.

## Step 6: Synthesize TODO.md from Commit "x"

Run:

```sh
git show <x>
```

(or equivalently `git diff <x>^ <x>`) where `<x>` is the commit created in
Step 5. This diff is the **single source of all feedback** — REVIEW.md comment
hunks and source-edit hunks alike.

Compose `TODO.md` in the project root. Structure it as a clear, actionable list
of tasks derived from all collected feedback. Group related items if helpful. Be
specific — reference file names, function names, or concepts from the REVIEW.md
explanations so each item has enough context to act on without re-reading the
diff.

Then normalize formatting:

```sh
node scripts/gtd.js format TODO.md
```

Use the same `scripts/gtd.js` path that was invoked to get this prompt.

Commit the result:

```sh
git add TODO.md
git commit -m "docs(review): synthesize TODO.md from review feedback"
```

## Step 7: Mechanical Teardown via Revert

Undo ALL reviewer changes by reverting commit "x":

```sh
git revert --no-edit <x>
```

**On conflict or non-clean exit (FAILURE BRANCH — STOP):**

If `git revert --no-edit <x>` exits with a conflict or any non-zero status,
immediately run:

```sh
git revert --abort
```

Then **STOP** and escalate to the human. Do NOT attempt to resolve conflicts
automatically. Do NOT leave a half-reverted working tree. Report exactly which
files conflicted and wait for manual resolution before proceeding.

**On success:**

If `REVIEW.md` is still tracked after the revert, remove it:

```sh
git rm REVIEW.md
```

Extract the short SHA (first 7 characters of the full hash from the
`<!-- base: … -->` comment recorded in Step 1):

```sh
git commit -m "chore(gtd): close approved review for <short-sha>"
```

Replace `<short-sha>` with the actual 7-character prefix of the base ref. This
commit subject must match exactly: `chore(gtd): close approved review for <short-sha>`.
