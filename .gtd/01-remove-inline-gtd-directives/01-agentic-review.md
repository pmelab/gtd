# Remove inline gtd re-run directive from agentic-review.md

## File

`src/prompts/agentic-review.md`

## Change

Remove the trailing paragraph (the agent directive after step 4). Verbatim text
to delete:

```
Re-run gtd — the edge reads `FEEDBACK.md`: an empty file closes the package; a
content-bearing one routes to a fix cycle and then re-reviews.
```

The auto-advance partial (`src/prompts/partials/auto-advance.md`), appended
programmatically by `src/Prompt.ts`, already covers the re-run behavior.

## Acceptance criteria

- [ ] The paragraph beginning "Re-run gtd — the edge reads `FEEDBACK.md`" is no
      longer present in `src/prompts/agentic-review.md`
- [ ] No other content in the file is changed
- [ ] File ends cleanly (no dangling blank lines or leftover fragment of the
      removed text)
