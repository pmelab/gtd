# Task: document last-package TODO.md removal in STATES.md

File: `STATES.md` (only this file)

## Context

Closing the last package now also deletes TODO.md, so the workflow terminates
at Clean/Idle instead of re-entering Grilling. Reflect this in the Close package
state description.

## Changes

In the **Close package (auto-advance)** section (~L269-279), update the
**Actions** sentence to note that when the finished package was the **last**
one, TODO.md is also removed.

Current:

> **Actions:** remove the empty FEEDBACK.md, delete the first (finished) package
> directory — plus the now-empty `.gtd/` if it was the last — and commit
> `gtd: package done`.

Add a clause covering TODO.md removal on the last package and why — e.g. that
removing TODO.md lets the next run fall through rule 6 (TODO.md → Grilling) to
rule 7 (Clean/Idle) instead of looping on Grilled.

## Acceptance criteria

- [ ] The Close package "Actions" description states that closing the **last**
      package also removes TODO.md.
- [ ] The note explains it prevents re-entering Grilling (rule 6 vs rule 7).
- [ ] No other STATES.md sections are altered.
- [ ] Do NOT touch README.md (per project memory: STATES.md is the authoritative
      redesign target; README sync is deferred).
