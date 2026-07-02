# Remove inline gtd stop directive from escalate.md

## File

`src/prompts/escalate.md`

## Change

Remove the trailing agent directive sentence. Verbatim text to delete:

```
After reporting, **STOP**. Do not re-run gtd — the user must act first.
```

The stop partial (`src/prompts/partials/stop.md`), appended programmatically by
`src/Prompt.ts`, covers this.

## Acceptance criteria

- [ ] The sentence "After reporting, **STOP**. Do not re-run gtd — the user must
      act first." is no longer present in `src/prompts/escalate.md`
- [ ] No other content in the file is changed
- [ ] File ends cleanly (no dangling blank lines or leftover fragment of the
      removed text)
