# Trim agent directive from grilling.md stop tail

## File

`src/prompts/grilling.md`

## Change

In the stop tail (after the `<!-- gtd:stop -->` marker), remove only the agent
directive while keeping the user-facing instruction.

Current text:

```
Tell the user to open `TODO.md`, answer each question inline (replacing its
`<!-- user answers here -->` marker with the answer), and re-run gtd. Then
**STOP** — do not edit `TODO.md`, spawn a subagent, or re-run gtd yourself. The
user must answer first.
```

Change to:

```
Tell the user to open `TODO.md`, answer each question inline (replacing its
`<!-- user answers here -->` marker with the answer), and re-run gtd.
```

- KEEP: the first sentence ("Tell the user to open `TODO.md`, answer each
  question inline ... and re-run gtd.") — this is a user-facing instruction.
- REMOVE: "Then **STOP** — do not edit `TODO.md`, spawn a subagent, or re-run
  gtd yourself. The user must answer first." — this is an agent directive; the
  stop partial covers it.

## Acceptance criteria

- [ ] The user-facing "Tell the user to open `TODO.md` ... and re-run gtd."
      sentence remains
- [ ] The "Then **STOP** — do not edit `TODO.md`, spawn a subagent, or re-run
      gtd yourself. The user must answer first." text is removed
- [ ] No other content in the file is changed
- [ ] File ends cleanly (no dangling blank lines or leftover fragment)
