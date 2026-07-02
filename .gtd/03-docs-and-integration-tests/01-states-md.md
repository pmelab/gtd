# Docs: document the Squashing state in `STATES.md`

Add the `Squashing` state to `STATES.md` (the target-design spec). Update the
precedence list and add a `### Squashing` section between `### Done` and
`### Idle`.

## Files

- `STATES.md` (edit)

Do NOT touch `README.md` (task 02) or any feature file (tasks 03/04).

## What to change

1. **`### Precedence (first match wins)`** — the squash fires after `gtd: done`
   lands, inside the boundary/clean rule. Update rule 7 (or add a rule between 4
   and 7 depending on how you frame it) to note that a clean, boundary HEAD of
   `gtd: done` with `squash` enabled and a squash base present routes to
   **Squashing** *before* the Clean/Idle decision. Keep the existing Clean/Idle
   wording for the non-`gtd: done` boundary cases.

2. **`### Squashing`** — new section (place it right after `### Done`, before
   `### Idle`), matching the style of the other state sections:

   - **Conditions:** no steering files, clean tree, HEAD is `gtd: done`, `squash`
     config enabled, and a squash base exists (the parent of the first persisting
     cycle commit, `gtd: grilling`).
   - **Actions:** prompt-bearing, auto-advance. The agent authors a single
     conventional-commits message summarizing the inlined full-process diff, then
     runs `git reset --soft <squashBase>` + `git commit -m "<message>"` itself
     (gtd's `src/` never runs the commit). The entire `<squashBase>..HEAD` range
     — every `gtd: *` commit and any interleaved non-gtd commit — collapses into
     one commit whose tree equals HEAD's tree (pure history rewrite, no code
     change).
   - **Prompt:** the squashing task prompt (message-authoring + squash commands),
     with an auto-advance tail (no STOP / human gate — Resolved Q1).
   - **Next:** Idle. After the squash, HEAD is a single non-`gtd:` boundary
     commit (`feat: …`); `isBoundary` treats it as a boundary, the `gtd: done` in
     this cycle is gone, so the next run settles Idle. Running gtd again does not
     re-squash (the range is a single boundary commit) — idempotent.

3. If `STATES.md` opens with a states count or table listing all states, update
   it (16 → 17) to include Squashing.

## Acceptance criteria

- [ ] Precedence section notes the `gtd: done` → Squashing routing before
      Clean/Idle.
- [ ] A `### Squashing` section documents conditions, actions (agent-run
      `git reset --soft` + commit over the whole range), prompt (auto-advance),
      and next (Idle, idempotent).
- [ ] Any total-state count in `STATES.md` reflects 17.
