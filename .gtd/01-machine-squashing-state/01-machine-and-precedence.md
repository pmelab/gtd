# Machine: add `squashing` state, payload fields, and precedence rule

Add the `squashing` state to the pure resolver in `src/Machine.ts` and its unit
tests in `src/Machine.test.ts`. The `squashing` state fires **after** the
`gtd: done` commit lands, before Idle: it is prompt-bearing and auto-advance (no
STOP), telling the external agent to author a conventional-commits message and
squash the whole process range. `src/` makes zero LLM calls and runs no git —
the machine only _decides_ to route to `squashing`; the agent does the work.

## Files

- `src/Machine.ts` (edit)
- `src/Machine.test.ts` (edit)

Do NOT touch `src/Events.ts`, `src/Prompt.ts`, `src/Config.ts`, or
`src/State.ts` in this task — they are owned by other tasks/packages. This task
only adds the type + fields + rule so the machine compiles and its unit tests
pass in isolation.

## What to change in `src/Machine.ts`

1. **`GtdState` union** — add `"squashing"`. Update the leading doc comment that
   says "The 16 resolved states" → 17.

2. **`ResolvePayload`** — add three fields (mirror how `reviewBase` / `refDiff`
   / `hasCommitsAfterLastDone` are documented):
   - `readonly squashBase?: string` — parent commit of the first persisting
     cycle commit (the Rule-1 review base). Set by the edge only when HEAD is
     `gtd: done` and squash is enabled.
   - `readonly squashDiff?: string` — `git diff <squashBase> HEAD`, the whole
     feature diff, inlined into the squashing prompt.
   - `readonly squashEnabled: boolean` — config kill-switch (per-resolve guard,
     read at the edge from `ConfigService.squash`).

3. **`DEFAULT_PAYLOAD`** — add `squashEnabled: false`. Leave `squashBase` /
   `squashDiff` unset (they are optional). Defaulting `squashEnabled` to `false`
   keeps every existing `Machine.test.ts` / `Machine.property.test.ts` case
   (which never sets it) resolving Idle after `gtd: done` exactly as today.

4. **`ResolveContext`** — add `readonly squashBase?: string` and
   `readonly squashDiff?: string` (passthrough for the prompt, mirroring
   `refDiff` / `reviewBase`).

5. **`buildContext`** — pass `squashBase` / `squashDiff` through with the same
   `...(p.x !== undefined ? { x: p.x } : {})` spread pattern already used for
   `refDiff` / `reviewBase`.

6. **Precedence rule** — in rule 7 (the `Clean / Idle` block, the
   `if (p.workingTreeClean && (isBoundary(head) || head === "gtd: package done"))`
   branch), add a check **before** the `reviewable ? "clean" : "idle"` return:

   ```ts
   if (head === "gtd: done" && p.squashEnabled && p.squashBase !== undefined) {
     return {
       state: "squashing",
       autoAdvance: true, // auto-advance, no STOP (Resolved Q1)
       context: buildContext(p, counters),
     }
   }
   ```

   No `edgeAction`: the squash is agent-driven (the agent runs
   `git reset --soft <squashBase>` + `git commit`), exactly like Clean delegates
   REVIEW.md authoring to the agent. `head === "gtd: done"` is the trigger
   point; the edge only sets `squashBase` when HEAD is `gtd: done`, but keep the
   `head` check explicit here so the rule reads self-contained.

   Placement note: `gtd: done` is a boundary (`isBoundary` returns true for it),
   so rule 7's guard already admits it. Put the squashing check as the first
   statement inside that `if` block, ahead of the existing `reviewable` logic.

7. Do NOT add a new `EdgeAction` kind. Do NOT change `isBoundary` — the squashed
   `feat:` commit is already a boundary, so a later run settles Idle unchanged.

## What to change in `src/Machine.test.ts`

Add a `describe("rule 7 — Squashing")` (or extend the existing rule-7 block)
with cases following the `DEFAULT_PAYLOAD` spread-override pattern (`r(...)`):

- HEAD `gtd: done` + `squashEnabled: true` + `squashBase` set →
  `state: "squashing"`, `autoAdvance: true`, `edgeAction` undefined.
- HEAD `gtd: done` + `squashEnabled: true` + `squashBase` unset → `idle`
  (nothing to squash — idempotent / already-squashed case).
- HEAD `gtd: done` + `squashEnabled: false` + `squashBase` set → `idle` (config
  opt-out).
- HEAD `gtd: done` with none of the squash fields (relying on `DEFAULT_PAYLOAD`)
  → `idle` (guards the default and keeps prior behavior).
- Optionally assert the context carries `squashBase` / `squashDiff` when set.

Verify the existing "HEAD gtd: done + clean + empty diff → idle" case still
passes (it must, because `DEFAULT_PAYLOAD.squashEnabled` is `false`).

## Acceptance criteria

- [ ] `"squashing"` is in the `GtdState` union; the module doc says 17 states.
- [ ] `ResolvePayload` has `squashBase?`, `squashDiff?`, `squashEnabled` with
      doc comments mirroring the review-base fields.
- [ ] `DEFAULT_PAYLOAD` sets `squashEnabled: false`.
- [ ] `ResolveContext` has `squashBase?` / `squashDiff?`; `buildContext` passes
      them through via the optional-spread pattern.
- [ ] The precedence rule routes HEAD `gtd: done` + enabled + `squashBase` set
      to `squashing` (auto-advance, no edgeAction), before the Clean/Idle
      decision.
- [ ] `src/Machine.test.ts` covers: enabled+base→squashing, no-base→idle,
      disabled→idle, default→idle.
- [ ] `npx vitest run src/Machine.test.ts src/State.test.ts src/Machine.property.test.ts`
      passes (vitest erases types, so Package 01's own test files run green in
      isolation once tasks 02 + 03 land their assertion/`ALLOWED` updates).

## Cross-package typecheck note (READ THIS)

Adding `"squashing"` to `GtdState` makes it a member of `Prompt.ts`'s
`PromptState`, so `Prompt.ts`'s
`SECTIONS: Record<Exclude<PromptState, "grilling">, string>` becomes
**non-exhaustive** and `npx tsc --noEmit` fails with
`src/Prompt.ts(52): Property 'squashing' is missing`. `Prompt.ts` is owned by
**Package 02 task 03** (which adds `SECTIONS.squashing`), NOT this task — do NOT
edit `Prompt.ts` here.

Consequence: a whole-project `tsc --noEmit` is RED after Package 01 alone and
only goes green once Package 02 task 03 lands. This is expected and acceptable —
Package 01's unit tests (via `vitest run`, which strips types) are green in
isolation; the project-wide typecheck gate is a Package-02-completion gate, not
a Package-01 one. The verifier confirmed exactly two `tsc` errors appear from
the union change: `Machine.property.test.ts` `ALLOWED` (fixed by task 03) and
`Prompt.ts` `SECTIONS` (fixed by Package 02 task 03).
