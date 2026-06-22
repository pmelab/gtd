# Task: Update README and SKILL docs for the new execute behavior

Reflect the two behavior changes in the user-facing docs: (1) the execute prompt
now NAMES the single next package and inlines its task-file contents (no more
"pick the lowest-numbered" / agent browsing `.gtd/`), and (2) execute deletes the
empty `.gtd/` on the last package, dropping the cleanup round-trip (the next run
goes straight to `human-review`; `cleanup` survives only as a safety net).

## Dependency

Sequential after packages 01–03 (the behavior must exist before it is
documented). Docs-only — no `src/` changes, no tests, no build.

## Implementation

- `README.md`:
  - Execute row of the state table (~line 57) and the "### 2. Execute" section
    (~line 242): replace "executes the next (lowest-numbered) package" /
    "handles exactly the lowest-numbered package remaining" framing with: gtd
    NAMES the single next package and inlines its task-file contents into the
    emitted prompt (self-contained; the agent does not browse `.gtd/` or choose).
  - State the last-package behavior: on the last package, the execute prompt also
    instructs removing the empty `.gtd/` in the same commit, so the next run goes
    straight to `human-review` — the `cleanup` round-trip is normally skipped.
  - The "### 3. Cleanup" section (~line 266) and the `cleanup` state-table row
    (~line 58): clarify `cleanup` is now a vestigial safety net for a stray empty
    `.gtd/` (e.g. created by hand), not part of the normal tail.
  - Mermaid diagram (~line 142): keep `cleanup` but note/route the normal
    last-package path straight to human-review (adjust the ".gtd/ empty" edge
    framing so it reads as the safety-net case). Keep the diagram valid.
- `SKILL.md`:
  - Step "2. Execute" (~line 82): replace "execute EXACTLY ONE package — the
    lowest-numbered package remaining" with the named-package + inlined-contents
    framing.
  - Step "3. Cleanup" (~line 91) and the `cleanup` leaf bullet (~line 134):
    note the last-package `.gtd/` removal happens inside execute and that
    `cleanup` is now a safety net.

## Acceptance criteria

- [ ] README execute section/row describe the named-package + inlined-task-
      contents prompt and no longer tell the agent to pick the lowest-numbered.
- [ ] README documents the last-package `.gtd/` deletion inside execute and that
      the cleanup round-trip is normally skipped (cleanup = safety net).
- [ ] README mermaid diagram still valid and reflects the new tail.
- [ ] SKILL.md execute + cleanup sections updated to match.
- [ ] No `src/` or test files modified by this task.

## Constraints / edge cases

- Keep the deterministic edge test-gate description (the edge runs `npm run test`
  before emitting the execute prompt) — that behavior is unchanged.
- Do not claim the `cleanup` leaf/state was removed — it is retained.

## Relevant files

- `README.md`
- `SKILL.md`
