# Docs: document Squashing + `squash` config in `README.md`

Reflect the new state in `README.md` (per the user's global rule: every
significant change is reflected in the README). The README documents the shipped
machine.

## Files

- `README.md` (edit)

Do NOT touch `STATES.md` (task 01) or any feature file (tasks 03/04).

## What to change

1. **State count** — the README says "16 states" in several places (e.g. "lands
   on exactly **one** of 16 states", "## The 16 states", "The decision core …
   whole 16-state …"). Update these to 17.

2. **The states table** (`## The 16 states` → `## The 17 states`) — add a
   **Squashing** row. Model it on the existing rows. Suggested cells:
   - Kind: `agent, auto` (prompt-bearing + auto-advance).
   - Condition: no steering files, clean tree, HEAD `gtd: done`, `squash` enabled,
     and a squash base present.
   - Action: agent authors a conventional-commits message from the full-process
     diff and runs `git reset --soft <base>` + `git commit` (squashes the whole
     `<base>..HEAD` range, folding in any interleaved commits).
   - Next: Idle.
   Place it between the **Done** and **Idle**/**Clean** rows consistent with the
   precedence order.

3. **Precedence ladder + mermaid diagram** (`### Precedence ladder (first match
   wins)` and the ```mermaid``` block) — add the `gtd: done` → Squashing hop
   before Idle. In the mermaid diagram, the Done node currently flows to Idle;
   insert a Squashing node so `Done → Squashing → Idle` (auto-advance edge), or
   reflect that a `gtd: done` HEAD with squash enabled routes through Squashing.

4. **The "typical feature" walkthrough** (`## A typical feature`) — the step that
   ends at Done/Idle now passes through Squashing: after the review is approved
   (`gtd: done`), gtd auto-advances to Squashing, the agent authors the
   conventional-commits message and squashes all `gtd: *` commits into one, then
   settles Idle. Mention `squash: false` disables it.

5. **Configuration section** (`## Configuration` → `### Schema`) — add a bullet
   for `squash` next to `agenticReview`:
   - **`squash`** (boolean, default `true`) — after an approved review completes
     (`gtd: done`), collapse all intermediate `gtd: *` commits (and any
     interleaved commits) into a single conventional-commits commit via
     `git reset --soft <base>` + `git commit`. Set `false` to keep the granular
     `gtd: *` history.
   - If the config example (`### Example`) lists `agenticReview: true`, add
     `squash: true` alongside it.

## Acceptance criteria

- [ ] All "16 states" references updated to 17.
- [ ] The states table has a Squashing row (agent/auto, conditions, action, next
      Idle).
- [ ] The precedence ladder and mermaid diagram include the Done → Squashing →
      Idle hop.
- [ ] The "typical feature" walkthrough mentions the post-`gtd: done` squash.
- [ ] The Configuration schema documents `squash` (boolean, default `true`,
      opt-out) and the example includes it.
