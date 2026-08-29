# Spec feedback — package 01

**Two rules were dropped, not compressed, in `src/workflows/unified.yaml`.**
Everything else in the package checks out: `npm test` is green, `oxfmt --check`
passes on the YAML, both new `templates.test.ts` pins exist in the existing
file, the digit-free and heading assertions still pass, `ReviewDoc.test.ts` and
`OpenQuestions.test.ts` still pass, the four attribution strings survive, var
names/persona set/splice points are unchanged, and no `message:`, `describe:`,
`label:`, `script:` or `#` comment was touched.

## 1. `humanReview.reviewing` lost the note-entirely-below-the-pointer rule, and

`Either way` now dangles

`src/workflows/unified.yaml:701`. The old block stated two valid note
placements, then scoped the bare-`./path` ban across both:

    A note that sits entirely on the line(s) beneath the pointer is
    also valid. Either way, the explanation itself must never start
    with a bare `./path` token — ...

The compressed block deleted the first sentence and kept `Either way`, which now
refers to nothing — only one placement is described above it.

**This is a dropped parser contract, not a dropped adjective.**
`src/ReviewDoc.test.ts:431` ("joins a same-line segment with below-pointer
lines") proves `parseReviewDoc` accepts a note that lives entirely below the
pointer. The prompt no longer tells the reviewer that form is legal, so the
reviewing agent will avoid a shape the parser supports — and Task 3's criterion
says this document contract is copied over unchanged.

Fix: restore the "a note sitting entirely on the line(s) beneath the pointer is
also valid" rule as its own clause ahead of the `Either way` sentence, so the
ban is scoped to both placements again.

## 2. `stateFileRules`'s `Its` has no antecedent, and now reads as the agent's own files

`src/workflows/unified.yaml:130-133`:

    - You are an autonomous coding agent
    - Its state files are a private scratchpad, never project code or
      documentation

The subject the possessive pointed at — **the workflow** — was deleted. `Its`
now attaches to the nearest noun, `agent`, so the bullet says the _agent's_
state files rather than the _workflow's_. This var is spliced into every
prompt-content state in the file, so the drift lands in ~10 prompts.

Fix: name the workflow in the bullet, e.g.
`- This workflow's own state files are its private scratchpad, never project code or documentation`.
Keep it a `- ` bullet, keep the var name.
