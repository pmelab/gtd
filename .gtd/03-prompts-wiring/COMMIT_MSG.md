feat(prompts): add human-review and verified prompts

Add the terminal human-review prompt (generates REVIEW.md identically to
review-create, then STOPs) and the verified prompt (runs tests on an
already-reviewed tree, then STOPs). Make verify auto-advance on green so the
workflow progresses into human-review. Wire both prompts into Prompt.ts.
