# Remove inline STOP directive from idle.md

## File

`src/prompts/idle.md`

## Change

Remove only the agent directive "and **STOP**" from the first sentence, keeping
the user-facing second sentence.

Current text:

```
Report that the repository is idle — nothing for gtd to do — and **STOP**. To
start something new, write a `TODO.md` (or leave pending changes in the working
tree) and re-run gtd.
```

Change to:

```
Report that the repository is idle — nothing for gtd to do. To start something
new, write a `TODO.md` (or leave pending changes in the working tree) and re-run
gtd.
```

- REMOVE: the " — and **STOP**" agent directive from the first sentence.
- KEEP: the user-facing second sentence about writing a `TODO.md` and re-running
  gtd.

## Acceptance criteria

- [ ] The first sentence reads "Report that the repository is idle — nothing for
      gtd to do." with no "and **STOP**"
- [ ] The user-facing second sentence "To start something new, write a `TODO.md`
      (or leave pending changes in the working tree) and re-run gtd." remains
- [ ] No other content in the file is changed
- [ ] File ends cleanly
