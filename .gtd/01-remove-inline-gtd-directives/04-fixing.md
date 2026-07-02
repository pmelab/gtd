# Remove inline gtd re-run directive from fixing.md

## File

`src/prompts/fixing.md`

## Change

Remove the trailing agent directive sentence. Verbatim text to delete:

```
Re-run gtd once the fix is in place — the fix returns through the test gate.
```

The auto-advance partial (`src/prompts/partials/auto-advance.md`), appended
programmatically by `src/Prompt.ts`, covers this.

## Acceptance criteria

- [ ] The sentence "Re-run gtd once the fix is in place — the fix returns
      through the test gate." is no longer present in `src/prompts/fixing.md`
- [ ] No other content in the file is changed
- [ ] File ends cleanly (no dangling blank lines or leftover fragment of the
      removed text)
