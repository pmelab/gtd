# Update README for the human-review / verified workflow

Reflect the new post-verify auto-review step in the README (and SKILL.md if it
documents the workflow). Per global instructions, every significant change must
be reflected in the README.

## Files

- `README.md`
- `SKILL.md` (only if it documents the state table / workflow; check first)

## Changes

### State → section table (~README.md:50-58)

The "Clean tree, no `.gtd/`, last commit was not `TODO.md`" row currently maps
to "Verify the working tree is healthy". Update / split it to reflect:

- Verify runs tests and auto-advances on green.
- After verify, when un-reviewed commits exist relative to the computed base →
  "Generate REVIEW.md for un-reviewed changes (human-review)".
- When nothing to review (no base / base == HEAD) → "Verified: healthy and fully
  reviewed".

Add a one-line note explaining the base = closest-to-HEAD of {parent-branch
merge-base, last review commit}.

### Mermaid workflow (~README.md:83+)

Update the diagram: the `Verify` node now advances. On green with un-reviewed
commits → a new `HumanReview[Generate REVIEW.md]` node (terminal, STOP). On
green with nothing to review → a `Verified[Healthy & fully reviewed]` terminal.
Show HumanReview handing off to the existing review-process path on the next run
(the user edits REVIEW.md).

### Typical-feature walkthrough (~README.md:100+)

Update step 8 ("When `.gtd/` is empty, `/gtd` cleans up and verifies") to show
the post-verify behaviour: after verify passes, `/gtd` auto-produces REVIEW.md
for the un-reviewed changes (human-review) and stops for the user; if everything
is already reviewed, it reports the tree healthy and fully reviewed (verified).

## Constraints

- Keep table formatting aligned with the existing markdown table.
- Keep mermaid syntactically valid.
- Be concise; match the existing doc voice.

## Acceptance criteria

- [ ] State table documents human-review and verified outcomes.
- [ ] Mermaid diagram shows Verify → HumanReview / Verified and the
      review-process handoff.
- [ ] Walkthrough mentions the auto-generated REVIEW.md after verify.
- [ ] SKILL.md updated if it duplicates this content (otherwise note it does
      not).
