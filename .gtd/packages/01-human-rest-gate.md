# 01 — Gate `gtd ui` on a human rest, and end the server when that rest moves

## Requirement

PRODUCT. `gtd ui` refuses to start on both steps it exists for, and starts only
on steps no human sits at. The gate is on the wrong axis.

`isRenderable` (`src/ui/Server.ts#287`) admits a step only when its content kind
is `prompt`. Seven states in `src/workflows/unified.yaml` carry a `mode:`. The
two with `actor: human` — `build.review.await-review` (line 767, `mode: review`)
and the QA `answer` gate (line 390, `mode: qa`) — both declare `message:`, so
the beat reports kind `message` and the gate rejects them. The remaining five
are `actor: agent` or `actor: check`: `design.triage` (423),
`architecture.author` (568), `build.review.reviewing` (712),
`build.review.deciding` (813), `build.review.collecting` (913). Those are the
only steps `gtd ui` will bind on today.

Verified live on this worktree resting at `build.review.await-review`: `gtd ui`
exits with "refuses to start — 'Awaiting your review' rests at message, which
has no phone screen".

The command exists to facilitate the steps where a HUMAN feeds a steering file.
Gate on that: a rest whose actor is human and whose `file` and `mode` resolve to
a registered steering format.

**The write path already gates on exactly that axis** — `writeNote` and
`writeValue` re-check `actorAt` per write and refuse `agent`, `check` and
`undefined` (`src/ui/Write.test.ts#147`, `#335`). So today's startup gate and
write gate contradict each other: every rest the server will start on is a rest
it will then refuse every write at. Aligning the two is the whole change.

**Content kind is the wrong axis regardless of which kinds are listed.** A
`message` state's kind shifts to `capture` the moment the human dirties the
tree, so a kind-based test is unstable under the very editing the UI invites.

`idle` stays load-bearing in the new predicate: an idle worktree reports
`actor: human` too — `ui.feature#43`'s own fixture declares its `idle` state
`actor: human` — so an actor-only test would start on a finished worktree. A
`broken` (unreadable) worktree keeps refusing.

The startup gate is checked once, so it shares one defect with the mid-flight
staleness already recorded in the review: the server's view of the rest is a
snapshot, and when the outer loop advances state while the server is up, `step`
reports the new rest to a client with no screen for it. Both sides of that
defect belong to this concern.

Fold in the one cleanup in the same code: `refusalFor` (`src/ui/Server.ts#302`)
hand-writes `Step | { status: "broken" ... }` where the union is already
`StepRead`.

**Acceptance**: a new e2e scenario resting at a human state that carries a
`file` and a registered `mode` — the shape of `await-review` — binds a port and
exits 0; it fails today with exit 2. All eight `ui.feature` refusal scenarios
still refuse after the change, because not one of them sets up a human rest
carrying a `mode` — but their asserted stderr moves off the content kind
("message", "capture", "script", "stalled") and onto the actor, so every one of
them is edited, not deleted. The exit-code set stays closed at five numbers.

## Paths

`src/ui/Server.ts`, `src/ui/Beat.ts`, `src/ui/Server.test.ts`,
`src/ui/Beat.test.ts`, `tests/integration/features/ui.feature`.

## Task 1 — Move `isRenderable` off content kind and onto the actor

`isRenderable` becomes, in order: not `idle`, `actor === "human"`,
`file !== undefined`, `mode !== undefined`,
`steeringFormatFor(mode) !== undefined`. `kind` is never read. This is the same
axis `verifyForWrite` already gates on (`actorAt !== "human"` → `not-resting`),
so startup and write agree for the first time.

- [ ] `isRenderable` in `src/ui/Server.ts` reads no `kind` field at all
- [ ] It narrows its argument to `Step & { file: string; mode: string }`
- [ ] `steeringFormatFor(step.mode) !== undefined` is the last check, so an
      unregistered mode refuses
- [ ] A unit test in `src/ui/Server.test.ts` admits a human, non-idle rest with
      `file` and `mode: qa` whose reported `kind` is `message`
- [ ] A unit test refuses an idle rest reporting `actor: human`

## Task 2 — Rewrite `refusalFor` over `StepRead`, four ordered sentences

The hand-written `Step | { status: "broken"; detail: string }` union is deleted,
not widened. Sentences are checked in this order so the narrower cause always
wins.

- [ ] `refusalFor` takes `StepRead` and the inline union at
      `src/ui/Server.ts#302` is gone
- [ ] broken — `this worktree can't be read: <detail>`, unchanged
- [ ] idle — `"<label>" is idle, so there is nothing to hand back`, checked
      BEFORE the actor test, because an idle worktree reports `actor: human` and
      an actor-only test would bind a port on a finished worktree
- [ ] non-human actor —
      `"<label>" rests with the <actor>, which has no phone     screen`, with
      `<actor>` substituted verbatim (`agent`, `check`)
- [ ] human rest with no usable steering file —
      `"<label>" rests with you, but     its steering file has no phone screen`,
      plus a hint naming the missing or unregistered `mode`
- [ ] Every refusal is still a `GtdUsageError`, so the exit stays 2 and the
      exit-code set stays closed at five numbers

## Task 3 — Edit all eight `ui.feature` refusal scenarios onto the new stderr

Every one keeps refusing. None is deleted.

- [ ] All eight refusal scenarios in `tests/integration/features/ui.feature`
      still refuse with exit 2 and bind no port
- [ ] Each asserted stderr moves off the content kind ("message", "capture",
      "script", "stalled") and onto the actor, the idle sentence, or the
      unregistered-mode sentence
- [ ] The scenario count in that file does not drop

## Task 4 — Expose `state` on `Step` as the rest's machine identity

The beat already parses `state` (`src/ui/Beat.ts#190`) and today only folds it
into `label`'s fallback. Exposing it gives a stable identity, where `label` is
prose a workflow edit can reword without the rest actually moving.

- [ ] `Step` gains `readonly state: string`
- [ ] `readStep` populates it from the parsed beat's own `state` field
- [ ] `label`'s existing fallback behaviour is unchanged
- [ ] A unit test in `src/ui/Beat.test.ts` asserts `state` survives a beat whose
      `label` and `state` differ

## Task 5 — End the process when the served rest moves

The server captures the served `state` at startup; the `step` procedure compares
every read against it. Exit 0, one step one exit.

- [ ] `runUiCommand` captures the narrowed step's `state` before binding
- [ ] The `step` procedure returns `{ status: "moved-on", label }` on a
      mismatch, on a read that has gone `broken`, and on a read that is no
      longer renderable
- [ ] That path calls the SAME idempotent end-of-life resolve the `done` path
      calls, so the process exits 0 exactly once
- [ ] Nothing spawns `gtd next --json` on a timer — detection rides the `step`
      query the client already issues. A polling timer would worsen the uncapped
      beat spawning that this branch accepts as an unfixed risk, to catch a case
      the next client read catches anyway
- [ ] A `src/ui/Server.test.ts` case where the second `step` read reports a
      different `state` asserts `moved-on` and a resolved handoff deferred

## Task 6 — Leave the write path and the close endpoint untouched

Two other bodies of work land on `src/ui/Write.ts`'s path gate and on the close
endpoint. Keeping this concern's lifetime work to a startup capture plus a
comparison inside the `step` resolver leaves both as clean, non-overlapping
edits.

- [ ] `src/ui/Write.ts` is unmodified by this package
- [ ] The body of the end-of-life resolve helper is unmodified
- [ ] The `POST /close` handler is unmodified

## Task 7 — The positive scenario that fails today

- [ ] A new scenario in `tests/integration/features/ui.feature` rests at a human
      state carrying a `file` and `mode: qa` — the shape of
      `build.review.await-review`
- [ ] It binds a port and exits 0
- [ ] It fails with exit 2 against the code as it stands before this package
