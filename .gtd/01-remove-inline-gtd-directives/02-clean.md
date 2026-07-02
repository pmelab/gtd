# Remove inline STOP block from clean.md

## File

`src/prompts/clean.md`

## Change

Remove the trailing ⛔ STOP block at the very end of the file. Verbatim text to
delete:

```
⛔ **STOP — do not re-run `gtd`.** The next cycle commits `REVIEW.md` as
`gtd: awaiting review` and stops for the user. Re-running gtd now advances
without human input.
```

The stop partial (`src/prompts/partials/stop.md`) now covers this once the
`promptState !== "clean"` exception is removed in `src/Prompt.ts` (see task 07).
This task only edits `clean.md`.

## Acceptance criteria

- [ ] The ⛔ STOP block is no longer present in `src/prompts/clean.md`
- [ ] No other content in the file is changed
- [ ] File ends cleanly (no dangling blank lines or leftover fragment of the
      removed text)
