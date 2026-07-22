# Exploration: every rest is a prompt — checks as a scripted actor

> **Historical design record.** The actor-kind model this explores (v2's
> gates/counters, actor kinds) was deleted by the v3 rewrite; superseded by
> `docs/design/pattern-machine-plan.md` and [STATES.md](../../STATES.md).

> Companion to `configurable-state-machine.md` (its Appendix C's δ-purity
> program is now fully landed — see `delta-purity-plan.md`). This document
> explores the next generalization: **executed commands become emitted
> prompts**, run by the outer loop as shell scripts under a third actor kind,
> with their results entering the machine the same way every other actor's work
> does — as working-tree modifications captured on the next invocation.

## 1. The idea

Today the machine has exactly one place where it executes external code itself:
the check (`runTest` / `runHealthCheck` in `src/Events.ts`, backed by the
`TestRunner` service). Everything else an invocation does is git/fs bookkeeping.
The check is also the only transition that branches on something other than a
diff — an **exit code** — and the only reason `perform()` needs a subprocess
executor, timeout semantics, and output capture inside the `gtd` process.

The generalization: make the check an **actor**. A state that today fires
`runTest` instead _rests_, awaiting a `check` actor. `gtd next` emits that
state's prompt — which for a scripted actor is a **shell script** — and the
outer loop executes it, exactly as it feeds an agent prompt to an LLM or shows a
human prompt in a terminal. The script's effects land in the working tree
(`.gtd/FEEDBACK.md` on a red run, nothing on green), and the next
`gtd step check` captures them as the check's turn, with capture rules deciding
the label from the pending diff — the same δ(label, diff) discipline every other
actor already follows.

The end state: **every rest is a prompt state** — for a human, an agent, or a
shell. The machine performs only bookkeeping; every external effect (human
thought, LLM inference, command execution) happens outside the loop and enters
exclusively through the tree.

```
rest ──gtd next──▶ prompt for the awaited actor
        human  → text in a terminal
        agent  → LLM prompt
        check  → shell script          ◀── the new kind
actor acts (edits the tree, or doesn't)
        ──gtd step <actor>──▶ capture rules label the turn from the diff
        ──routing chains──▶ next rest
```

## 2. What executes where today (the residue)

| Effect                    | Where it runs today                   | Enters the machine as               |
| ------------------------- | ------------------------------------- | ----------------------------------- |
| Human thought             | outside (terminal)                    | pending diff → captured turn        |
| Agent inference           | outside (harness/LLM)                 | pending diff → captured turn        |
| **Test / health command** | **inside `perform()` (`TestRunner`)** | **exit code → branch in `perform`** |
| Git/fs bookkeeping        | inside `perform()`                    | commits (labels + trailers)         |

The third row is the asymmetry this exploration removes. Note that Phase C
already moved the _decision_ to write time (the red/green/cap outcome is encoded
in the label the check writes) — but the _execution_ still lives inside the
invocation, which is why `gtd step agent` can block for the length of a test
suite, why `TestRunner` needs spawn-failure/timeout/empty-output handling
in-process, and why the `@inmem` e2e tier still spawns real subprocesses for
`testCommand`.

## 3. The model

### 3.1 A third actor kind: `scripted`

`ActorDef.kind` gains a third value alongside `interactive` and `autonomous`:

```ts
actors: [
  { name: "human", kind: "interactive" },
  { name: "agent", kind: "autonomous" },
  { name: "check", kind: "scripted" },
]
```

The turn-taking engine keys on the kind, as it already does:

- **interactive** — dirty boundary tree is the entry turn; empty turns are
  meaningful signals.
- **autonomous** — clean-tree steps at inert gates are no-ops; drafts are
  structurally validated.
- **scripted** — its prompt is executable; its turn is _mechanical_ (the driver
  runs the script verbatim and steps — there is no judgement in between). Its
  empty turn is typically the green signal (an opt-in `empty` rule, as
  everywhere else).

Nothing else in the engine changes: refusals, the fixpoint, and capture rules
are actor-generic already (the actor generalization landed earlier).

### 3.2 The prompt is the script — and gtd generates it

The state's prompt template for a scripted actor renders a **wrapper script**,
not the raw `testCommand`:

```bash
#!/usr/bin/env bash
# gtd check turn — run verbatim, then: gtd step check
set +e
npm run test > .gtd/.check-output 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  mkdir -p .gtd
  if [ -s .gtd/.check-output ]; then mv .gtd/.check-output .gtd/FEEDBACK.md
  else echo "Test command \`npm run test\` failed with exit code $code and produced no output." > .gtd/FEEDBACK.md
  fi
else
  rm -f .gtd/.check-output
fi
```

gtd owns the wrapper's shape (output capture, the empty-failure sentinel, the
target file), templated from config at emit time — the driver stays dumb. This
keeps the machine the single author of check mechanics while moving the
_execution_ out.

### 3.3 Mechanics in the script, semantics at capture

A crucial split, learned from the Phase C work: the script must encode only
**mechanics** (did it exit non-zero; what was the output), never **semantics**
(is the budget spent; is this an escalation). Semantics belong in the capture
rules, decided from the pending diff plus the trailer vector at step time:

```ts
testing: {
  kind: "prompt",
  awaits: "check",
  prompts: { check: "@run-test" },
  captureRules: [
    // red at the cap — same file, different label; the escalated label's
    // routing chain renames FEEDBACK.md → ERRORS.md as bookkeeping
    { when: (p) => p.feedbackPresent && p.counters.testFixCount >= p.fixAttemptCap,
      label: "escalated", stamp: carry },
    // red below the cap
    { when: (p) => p.feedbackPresent, label: "test-failed", stamp: tPlus1 },
    // green — the outcome labels already decided at write time today,
    // now decided at capture of the check's empty turn
    { empty: true, when: (p) => p.packagesPresent && !forceApprove(p), label: "agentic-review" },
    { empty: true, when: (p) => p.packagesPresent, label: "close-package-approved" },
    { empty: true, label: "tests-green", stamp: h0 },
  ],
}
```

Why this split matters: if the script encoded `capReached` (as `perform()` does
today), a script emitted before the budget changed and executed after would
write the wrong file — a stale-script race with two sources of truth. With
semantics at capture, a stale script is harmless: the mechanics it performs
(write FEEDBACK.md with the output) are timeless, and the label — the part that
steers — is decided against the _current_ trailer when the turn is captured.
This is the δ discipline applied once more: the diff carries facts, the capture
encodes meaning.

### 3.4 Wire format

Check turns land as ordinary turn commits in the existing grammar:

```
gtd(agent): building          ← the build turn
gtd: testing                  ← routing: rest, awaiting check   (label state today)
gtd(check): test-failed       ← the check's captured turn (FEEDBACK.md in its diff)

Gtd-Counters: t=1 r=0 h=0
gtd(agent): fixing            ← the fixer's turn
gtd: testing
gtd(check): agentic-review    ← green, packages, threshold not reached

Gtd-Counters: t=1 r=0 h=0
```

`git log --oneline` becomes a _complete_ trace: today the check outcome appears
as a bare machine label; under this model it is attributed — you can see that
the check actor ran, when, and what it concluded, exactly as for humans and
agents. Old histories remain inert boundaries (closed-set rule), and the trailer
scheme carries over unchanged.

## 4. What each current piece becomes

| Today                                             | Under the scripted actor                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `runTest` / `runHealthCheck` edge actions         | deleted — `testing`/`health-check` become prompt states awaiting `check`       |
| `TestRunner` service (spawn, timeout, output)     | deleted from gtd; wrapper script + driver responsibility                       |
| exit-code branch in `perform()`                   | capture rules on the check state (diff + trailer)                              |
| `onGreen` decided at dispatch                     | green outcome decided at capture of the check's empty turn — same write moment |
| `capReached` baked into the action                | capture-rule guard reading `p.counters` — no stale-script race                 |
| empty-failure sentinel in TS                      | templated into the wrapper script                                              |
| `gtd step agent` blocks for the test suite        | `gtd` returns instantly; the loop runs the script between invocations          |
| `@inmem` e2e runs real `testCommand` subprocesses | scenarios write FEEDBACK.md by hand and `gtd step check` — fully in-memory     |
| loop protocol: agent-only dispatch                | uniform: read `gtd next --json`, dispatch on the awaited actor's kind          |
| `testCommand` consumed by `TestRunner`            | consumed by the prompt template (config → script text)                         |

And the generalization dividend: **any state can declare a scripted gate.** A
lint pass before review, a deploy verification after close-package, a schema
check between grilling and architecting — all become one `StateDef` with
`awaits: "check"` (or a second scripted actor with its own command), zero new
engine code. This is the missing piece of the original "completely configurable
state machine" goal: mechanical gates were the one transition type a user
couldn't add through configuration.

## 5. What this buys

1. **The machine's last impurity is gone.** `perform()` becomes pure git/fs
   bookkeeping; the Effect graph loses `TestRunner` and `CommandExecutor`; the
   always-clean invariant becomes structural (nothing inside gtd can block or
   die mid-run with a half-written tree).
2. **`gtd` becomes instant and deterministic.** Every invocation is a pure
   resolve + bookkeeping hop. All nondeterminism (LLM, human, subprocess) is
   outside — which is also exactly what makes the property-test story and the
   `@inmem` tier stronger.
3. **One protocol.** The outer loop stops special-casing: every iteration is
   "ask `gtd next` who's up and what the prompt is; produce that actor's turn;
   `gtd step <actor>`". Timeouts, retries, and sandboxing of the test command
   move to the driver, which already owns them for the agent.
4. **Attributed history.** Check outcomes are turns with an author, a diff, and
   a trailer — `git log` reads as a complete conversation between three actors.
5. **Configurable mechanical gates** (see §4) — without touching gtd.

## 6. Where it falls down

1. **It breaks the CLI contract — this is NOT behavior-preserving.** Every
   driver and all ~40 feature files change shape: `gtd step agent` no longer
   runs the tests; a check that used to be one invocation is now three
   (`step agent` → run script → `step check`). Unlike the δ refactor, there is
   no way to hide this behind the same e2e suite. It is a major version with a
   migration story, not an internal refactor.
2. **Human ergonomics regress without a driver.** Today a human at `escalate`
   runs `gtd step human` and the re-test happens. Under this model they must
   copy-paste a script and run a second command. Mitigation: a thin optional
   convenience — `gtd run` (or the loop skill) that executes the _emitted_ check
   script verbatim and immediately steps the check actor. The machine still
   never executes; the convenience wrapper does, behind an explicit opt-in
   command whose only input is gtd's own emitted script. This preserves the
   purity boundary while keeping the two-keystroke UX.
3. **The idle carve-out gets awkward.** Idle today awaits the human, and a human
   step re-runs the health check inline. If idle awaits `check` instead, a bare
   `gtd step human` at idle would be refused — hostile. Options: keep the idle
   carve-out (a human step at idle _is_ the check turn's trigger via the
   convenience wrapper), or split idle (rest for human) from a health-check
   state (rest for check) that the human's empty idle turn chains into. Needs a
   decision; neither is free.
4. **Generated bash is a liability.** Quoting the configured command, platform
   variance (POSIX sh vs bash vs Windows), output-size limits — all move from
   unit-tested TypeScript into templated script text that can only be tested by
   executing it. The wrapper must stay tiny and boring; anything clever belongs
   in capture rules.
5. **The prompt channel now carries executable code.** `testCommand` is already
   arbitrary code execution by config, so the _trust_ is unchanged — but the
   _transport_ changes: drivers must execute only the script emitted by
   `gtd next` for a scripted actor, never script-looking content from
   agent-authored files. The `--json` output should carry the actor kind and the
   script in a dedicated field so drivers never have to parse prose.
6. **Two extra hops per check.** Negligible for an agent loop (the test run
   dwarfs them), noticeable for scripted gates used as fast validations. The
   fixpoint chaining could allow `step check` to be invoked by the driver
   immediately after the script with no intervening `next`, keeping it to one
   extra invocation.
7. **A non-cooperating driver can stall the machine.** Today a check cannot be
   skipped: `step agent` runs it, period. Under this model a driver could keep
   stepping other actors... except it can't — the rest awaits `check`, and every
   other actor is refused out-of-turn. The stall is real (nothing runs the
   script), but the safety property (nothing _bypasses_ the gate) is exactly as
   strong as today's, enforced by the same refusal mechanism.

## 7. Verdict

This is the natural completion of the δ program: after Phase C, the check's
_decision_ already lives at write time and its _budget_ already rides on
trailers — the only thing still inside the machine is the subprocess itself.
Moving it out makes every rest a prompt and every actor a peer, at the cost of a
breaking CLI/protocol change and a real (but boundable) bash-templating
liability.

If pursued, the phasing writes itself:

- **Phase 1 — dual-mode:** add the `scripted` kind, the check states' capture
  rules, and `gtd step check`; keep `runTest` as a deprecated inline path so the
  existing e2e suite stays green while a parallel suite drives the new protocol.
- **Phase 2 — flip the default:** loop skill dispatches on actor kind; `gtd run`
  convenience lands; feature files migrate scenario by scenario (each check hop
  becomes script-run + step).
- **Phase 3 — delete:** `TestRunner`, `runTest`/`runHealthCheck`, and the
  idle/testing carve-outs (per the idle decision taken in Phase 1).

The one decision worth taking _before_ any of this: §3.3's mechanics/semantics
split. Even today's inline check could be restructured so the label is decided
purely from (written file, trailer) — that is the piece that makes the model
safe, and it is adoptable independently of everything else here.
