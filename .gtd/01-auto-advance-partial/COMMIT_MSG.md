feat(prompts): add auto-advance partial and wire into prompt builder

Create src/prompts/partials/auto-advance.md with standardized re-run
instruction. Update Prompt.ts to append auto-advance to prompts that
should trigger automatic re-running (all except verify and review-create).
