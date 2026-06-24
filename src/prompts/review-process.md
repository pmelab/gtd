# Process Review Feedback

You are processing feedback from a code review session. The reviewer has
annotated `REVIEW.md` and may have directly edited source files to illustrate
changes.

## Step 1: Read REVIEW.md for Context

Read `REVIEW.md`. It contains:

- **Chunk titles and explanations** written by the tool that generated it —
  these describe what each diff chunk does; use them as context when
  interpreting feedback.
- **Base ref** (noted at the top) — the commit the review was based on.
- **Reviewer comments** — text the user added (inline or between chunks).
- **Checkboxes** — informational only; do not treat checked/unchecked as
  approval or rejection. Read all content regardless of checkbox state.

## Step 2: Read the Working Diff

Run `git diff` (and `git status` for untracked files) to see what the reviewer
changed during the session.

## Step 3: Interpret All Source Modifications as Feedback

Treat **every** modification to a source file as intentional reviewer feedback.
There is no marker convention — if the reviewer edited a file, that edit
expresses a desired change or demonstrates an issue.

Do not re-examine the original diff from the base ref. The explanations already
present in `REVIEW.md` provide sufficient context for understanding what each
chunk was about.

## Step 4: Collect All Feedback

Gather feedback from three sources:

1. **REVIEW.md comments** — any text the reviewer added to the file (inline
   notes, questions, suggestions written between or inside chunks).
2. **Source file edits** — describe what was changed and infer the reviewer's
   intent from the surrounding REVIEW.md explanation.
3. **`!!` follow-up comments in the reviewed code** — gtd has already harvested
   the reviewer-added `!!` comments — the `!!` tokens on lines added since the
   `review(gtd): create review …` commit — regardless of which files `REVIEW.md`
   references, and inlined them in the Context above under "`!!` follow-up
   comments". Pull each one into `TODO.md` verbatim, with enough context (file,
   function, what needs to be done) to act on it later — intent is not parsed;
   capture exactly what the comment says. Plain `TODO:` comments are ordinary
   code and are **not** harvested — only `!!` comments are.

## Step 5: Compose TODO.md

Write `TODO.md` in the project root. Structure it as a clear, actionable list of
tasks derived from all collected feedback. Group related items if helpful. Be
specific — reference file names, function names, or concepts from the REVIEW.md
explanations so each item has enough context to act on without re-reading the
diff.

## Step 5b: Format TODO.md

Run `node scripts/gtd.js format TODO.md` (use the same `scripts/gtd.js` path you
invoked to get this prompt) to normalize formatting.

## Step 6: Commit Raw Feedback Verbatim

Before resetting, preserve the reviewer's entire working tree as a dedicated
commit. This keeps the annotated `REVIEW.md` (with checkboxes), all source
edits, any untracked files added during the session, and in-place `TODO:`
markers in git history — exactly as the reviewer left them.

Read the `<!-- base: … -->` comment at the top of `REVIEW.md` to get the base
ref (you already read this in Step 1). Then run:

```sh
git add -A
git commit -m "docs(review): record raw feedback for <base>"
```

Replace `<base>` with the actual base ref from the `<!-- base: … -->` comment.
Do not modify any file content — commit verbatim.

The subsequent reset and synthesis commit will run on top of this commit. The
synthesis commit will revert the source edits; that churn is acceptable and
expected — do not try to avoid it.

## Step 7: Reset — Exact Order Required

Execute the reset sequence in this exact order:

```sh
# 1. Stage TODO.md FIRST so it survives the reset
git add TODO.md

# 2. Reset all tracked files to HEAD (discards reviewer's source edits and REVIEW.md edits)
git checkout -- .

# 3. Remove any untracked files the reviewer added during the session
git clean -fd

# 4. Delete REVIEW.md (it was tracked, so checkout restored it; delete it now)
rm REVIEW.md
```

After these commands: only `TODO.md` (staged) and the `REVIEW.md` deletion
remain as pending changes.

## Step 8: Commit

```sh
git add -A
git commit -m "docs(review): process review feedback into TODO.md"
```

The commit includes:

- `TODO.md` added (the extracted feedback)
- `REVIEW.md` deleted (review session cleaned up)

No source file changes are committed — those were illustrative edits by the
reviewer, now captured as tasks in `TODO.md`.
