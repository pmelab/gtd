# Testing plan: full-process walkthrough in an example project, JSON mode only

Manual e2e verification of the v2 command surface **and the actual prompts**.
The tester plays only the **human** actor (answers in `.gtd/TODO.md`, review
annotations, deleting `.gtd/ERRORS.md`, harness toggles). Every **agent** turn
is executed by feeding the real prompt to a live agent:

```bash
claude --dangerously-skip-permissions -p "$prompt"
```

— no manual code changes by the tester, ever. Every gtd invocation uses
`--json`; assert on the JSON fields (`state`, `actor`, `pending`, `prompt`,
`commits`, `actions`, `predictedCommit`, `predictedState`) and exit codes, never
on plain text.

## Setup

- [ ] Build the branch binary: `npm run build` in this worktree; use
      `GTD="node <worktree>/dist/gtd.bundle.mjs"` everywhere (never the
      installed/skill copy — it may be stale).
- [ ] Scratch project outside the repo (e.g. `/tmp/gtd-json-e2e`):
      `git init -b     main`, one initial commit (`README.md`), a toggleable
      test harness:
  - `test.sh` → `exit "$(cat .test-mode 2>/dev/null || echo 0)"`
  - `.gitignore` → `.test-mode` (load-bearing: toggle must not dirty the tree)
  - green: `echo 0 > .test-mode`, red: `echo 1 > .test-mode`
  - The toggle decides test outcomes **independently of the agent's code** —
    that keeps the red paths deterministic while the agent still writes real
    code from the real prompts.

### The agent beat

After every human turn, run this until it halts (mirrors the reference driver in
docs/loop.md; the JSON `prompt` carries no tail, so the driver — not the agent —
closes each turn with `step-agent`):

```bash
while true; do
  $GTD step-agent --json || true
  next="$($GTD next --json)"
  actor="$(jq -r .actor <<<"$next")"
  prompt="$(jq -r .prompt <<<"$next")"
  [[ "$actor" != "agent" ]] && break   # human owns the next move — stop
  [[ "$prompt" == "null" ]] && continue # pending checkpoint — resume
  claude --dangerously-skip-permissions -p "$prompt"
done
```

For phases that need per-beat inspection or toggle re-assertion (5, 6, 7), run
the three steps of one iteration by hand instead of the loop.

## Phase 0 — CLI surface, guards, auto-init

- [ ] Bare `gtd` → exit 1, usage error.
- [ ] `--version` / `--help` work outside any repo.
- [ ] Any state command from a subdirectory → exit 1, repo-root refusal; in
      `--json` mode the error envelope `{"state":"error","prompt":"…"}` on a
      single line, still exit 1.
- [ ] `gtd format x.md --json` → exit 1 (`format` rejects `--json`).
- [ ] First state-command run with **no** config anywhere → auto-init commits
      `chore: add .gtdrc.json` stub at git root. Verify, then overwrite with the
      test config:
      `{testCommand: "sh ./test.sh", fixAttemptCap: 2, reviewThreshold: 2, agenticReview: true, squash: true}`
      (low caps keep the loop phases short); commit it.

## Phase 1 — idle baseline, idempotence, out-of-turn

- [ ] `gtd status --json` →
      `{state:"idle", actor:"human", predictedCommit:null,     predictedState:"idle"}`
      (green health check predicted as no-op).
- [ ] `gtd next --json` → `{state:"idle", actor:"human", pending:false}`, prompt
      addresses the human.
- [ ] `gtd step --json` (green toggle) → health check runs, zero `commits`, exit
      0, state idle. Re-run → still zero commits (idempotence).
- [ ] `gtd step-agent --json` at idle → out-of-turn refusal: exit 1, zero
      commits, error envelope names `gtd step`.

## Phase 2 — grilling: capture, answer round, accept-defaults round

- [ ] Seed an idea: write `IDEA.md` ("add a greet(name) function to lib.js;
      greeting format and null-name handling are open questions"), leave
      uncommitted. Open questions give the grilling agent something real to ask.
- [ ] Dirty tree: `gtd next --json` → refusal envelope (exit 1);
      `gtd status --json` still works → predicts `gtd(human): grilling`.
- [ ] `gtd step --json` → commits `["gtd(human): grilling"]`, rest at grilling.
- [ ] `gtd step --json` again now → out-of-turn refusal (agent is awaited).
- [ ] Agent beat → the grilling prompt (verify it inlines the captured diff)
      drives claude to develop `.gtd/TODO.md` with suggested defaults; beat
      closes the turn as `gtd(agent): grilling` and halts at the answer gate.
- [ ] **Answer round**: edit `.gtd/TODO.md` with a real answer that contradicts
      a suggested default (deterministic feedback lever — also demand a strict
      acceptance criterion, e.g. exact error message for null names; Phase 6
      relies on it), `gtd step --json` → fresh `gtd(human): grilling`; agent
      beat iterates the plan.
- [ ] **Accept-defaults round**: clean tree, `gtd step --json` → commits
      `["gtd(human): grilling", "gtd: grilled"]` (empty turn + routing), state
      `grilled`.

## Phase 3 — decompose

- [ ] Agent beat → decompose prompt spawns claude to break `.gtd/TODO.md` into
      packages. Verify it produced sequential `.gtd/01-…/`, `.gtd/02-…/`
      directories with self-contained task files (if it made only one package,
      re-seed with a slightly bigger idea — two packages are needed for the
      package-done → next-package selection case).
- [ ] After the beat's `step-agent`: rest at `building`; `gtd next --json` names
      package 01 and inlines only its task files.

## Phase 4 — build → green → agentic review

- [ ] Toggle green. Agent beat → building prompt drives claude to implement
      package 01 and leave it uncommitted; beat commits `gtd: building`, runs
      tests → `gtd: tests green`, rest `agentic-review`.
- [ ] Agent beat continues → agentic-review prompt drives claude to write
      `.gtd/FEEDBACK.md`. Outcome is live-agent-dependent:
  - **Findings** (non-empty): rest `fixing`; verify the fixing prompt inlines
    the feedback; next beat fixes and re-tests → re-review.
  - **Approval** (empty): same invocation closes the package —
    `gtd: package done`, `.gtd/01-…/` and `.gtd/FEEDBACK.md` gone, rest
    `building` for package 02. If approval came immediately, findings-round
    coverage falls to Phase 6.

## Phase 5 — red tests, fix budget, escalate, human reset

Run beats by hand here: claude will try to "fix" the failure and may discover
the `.test-mode` toggle — re-assert red between the claude run and the next
`step-agent`.

- [ ] Package 02: **toggle red**, beat → `gtd: building` → `gtd: errors`, rest
      `fixing` (exit 0 — red below cap is a normal step, not a failure).
- [ ] Stay red for `fixAttemptCap` (2) rounds of the fixing prompt →
      `.gtd/ERRORS.md` written, rest `escalate`, `gtd next --json` →
      `actor:"human"`.
- [ ] `gtd step-agent` at escalate → out-of-turn refusal.
- [ ] Human reset: delete `.gtd/ERRORS.md`, toggle green, `gtd step --json` →
      `gtd(human): escalate` + immediate re-test in the same invocation (budget
      reset), chain continues to `agentic-review`.

## Phase 6 — findings rounds and force-approve at reviewThreshold

- [ ] Provoke findings on package 02: the strict criterion planted in Phase 2
      should be visibly unmet (if claude nailed it, add a human review-style
      lever later — record partial coverage rather than hand-editing code).
- [ ] Drive **2** findings rounds (reviewThreshold: 2), verifying
      `.gtd/FEEDBACK.md` content flows into each fixing prompt. On the round
      that would exceed the threshold, verify Agentic Review **force-approves**:
      no `.gtd/FEEDBACK.md` written, package closes straight to
      `gtd: package done`. All packages now closed.

## Phase 7 — mid-chain checkpoint (`pending: true`) via failure contract

- [ ] Before the review chain: temporarily set `testCommand` to a nonexistent
      binary anywhere a test run is next; `gtd step-agent` → exit 1
      (`test command not found`), HEAD left mid-chain (no rollback).
- [ ] `gtd next --json` → `{pending:true, prompt:null}` + the actor whose chain
      it is; `gtd status --json` still pure/side-effect-free.
- [ ] Restore `testCommand`; the named mutator resumes the chain from the
      checkpoint. (Config edits ride along or commit them — note behavior.)

## Phase 8 — human review gate: feedback, checkbox approval, clean approval

- [ ] All packages closed → agent beat: claude writes `.gtd/REVIEW.md` from the
      review prompt, routing `gtd: awaiting review`, rest `await-review`,
      `actor:"human"`; beat halts.
- [ ] **Feedback**: substantive edit to `.gtd/REVIEW.md` prose (a real finding
      about the built code), `gtd step --json` → `gtd: review feedback`,
      `.gtd/REVIEW.md` removed, `gtd next` re-emits a grilling prompt to the
      agent inlining the finding. Agent beat drives that mini-cycle back to
      `await-review` — verify the finding actually reached the agent's plan.
- [ ] **Checkbox approval**: flip only `- [ ]` → `- [x]`, `gtd step --json` →
      treated as clean approval, routing `gtd: done`.
- [ ] (If a third pass is cheap, also verify the fully-clean no-edit approval —
      otherwise the empty-turn variant is already covered by Phase 2.)

## Phase 9 — squash

- [ ] With `squash: true`: `gtd: done` chains to `gtd: squash template`,
      `.gtd/SQUASH_MSG.md` committed; agent beat → squashing prompt drives
      claude to overwrite `.gtd/SQUASH_MSG.md` with a real conventional message
      (verify it draws on grilling-round decisions); the beat's `step-agent`
      performs the soft-reset squash: whole cycle now **one** commit with that
      message verbatim; `.gtd/` empty/gone.
- [ ] **Do not** re-run gtd afterwards "to confirm idle" — verify with `git log`
      / `git status` only (re-running triggers a review cycle).

## Phase 10 — health check / health-fixing (idle path)

- [ ] Toggle red at idle, `gtd step --json` → health check red →
      `.gtd/HEALTH.md`, rest `health-fixing`, `actor:"agent"`.
- [ ] Toggle green (the "fix"), agent beat → health-fixing prompt drives claude;
      its turn removes `.gtd/HEALTH.md`, re-tests green in the same chain → back
      toward idle/squash.
- [ ] Red-at-cap variant: stay red 2 rounds (re-assert red after each claude
      run) → `.gtd/ERRORS.md` → `escalate`; recover via Phase-5 human reset.

## Phase 11 — ad-hoc `gtd review <target>`

- [ ] Branch off main, add a plain commit. `gtd review main` → exactly one
      commit `gtd: reviewing <full-hash>`; agent beat → review-record prompt
      scoped to that anchor, claude writes `.gtd/REVIEW.md`; drive through
      `await-review` → approval.
- [ ] Error cases (all exit 1): dirty tree, missing target, extra args,
      unresolvable ref, empty diff after filtering.

## Phase 12 — config kill-switches (short second cycle)

- [ ] `agenticReview: false`: run a one-package cycle → green tests skip the
      review gate entirely (`gtd: tests green` → force-approve → package done).
- [ ] `squash: false`: `gtd: done` is the resting boundary; no
      `.gtd/SQUASH_MSG.md` ever written; granular history preserved.
- [ ] Invalid config: unknown key / bad type → exit 1, `Invalid gtd config: …`
      on stderr, stdout untouched.

## Interactive mode (Phases 13–15)

The JSON phases above never exercise what a real user sees: the plain formatter,
TTY rendering, or the loop skill driving an interactive session. Three layers,
same toggle harness, fresh scratch repo per layer.

## Phase 13 — plain-mode formatter pass (no claude, deterministic)

The subject is the OUTPUT FORMAT, not prompt quality — for this layer only, the
tester plays both actors by hand and asserts on plain (non-`--json`) output
against the documented contract (docs/cli.md):

- [ ] `step`/`step-agent`: one `committed: <subject>` line per authored commit
      (oldest→newest), then a final `state: <state>` line; nothing else.
- [ ] `next` at an **agent** rest: prompt ends with the exact pinned tail
      ("Finish your turn by running `gtd step-agent`. Then run `gtd next` …").
- [ ] `next` at a **human** rest: no tail of any kind.
- [ ] `next` at a mid-chain HEAD: the documented checkpoint line, naming the
      correct mutator for the chain's actor.
- [ ] Refusals: out-of-turn ("<state> awaits a … turn — run `gtd …`"),
      dirty-tree `next`, repo-root guard — exact wording, stderr, exit 1.
- [ ] `status`: exactly the four
      `State/Awaits/Predicted commit/Predicted     state` lines; `(none)` at a
      fixpoint.
- [ ] `review <target>`: the one-line "anchored review at <hash> — …"
      confirmation, never a prompt.

## Phase 14 — PTY pass (spinner / newline behavior)

Plain mode again, but under a real pseudo-terminal (`script -q /dev/null …` or a
tmux pane) so the spinner/renderer code path runs — piped output cannot
reproduce the `ensureNewline`/`rendererDirty` class of bugs:

- [ ] No glued lines: every `committed:`/`state:` line starts at column 0; no
      output appended to a spinner remnant, across succeed AND fail exits.
- [ ] No stray ANSI/carriage-return artifacts in captured output.
- [ ] `--verbose` and `--debug` each change exactly one concern, and neither
      implies the other (run the same command all four ways).

## Phase 15 — interactive dogfood (loop skill in a live session)

The real contract: an interactive claude session drives the loop itself via
`skills/loop/SKILL.md`. The tester supervises and plays only the human.

- [ ] Setup: copy the BRANCH's `skills/loop/` into the scratch repo's
      `.claude/skills/loop/` (never the installed copy — it goes stale), put the
      branch `gtd` wrapper on PATH, seed an idea file.
- [ ] Spawn an interactive claude session with cwd at the repo root (inside
      herdr: a new tab via the herdr skill; otherwise tmux) and kick it off with
      `/loop`.
- [ ] **Halt discipline** (the core assertion): the session halts on its own at
      every `actor:"human"` point — the answer gate, `await-review`, escalate —
      reporting the state, and never acts on the human's behalf.
- [ ] Agent-side chaining: successive build/test/review turns proceed without
      the tester nudging between them; pending checkpoints resume via
      `step-agent` alone.
- [ ] Human beats: the tester edits files (answers, checkbox flips, deleting
      `.gtd/ERRORS.md`) + `gtd step` from outside, then tells the session to
      continue; the loop picks up correctly.
- [ ] Stall detection: if state+prompt repeat with no new commits, the session
      halts and escalates rather than spinning (provoke once via the red toggle
      if the opportunity arises).
- [ ] Red-phase supervision: a live agent will hunt the `.test-mode` toggle —
      re-assert it between its actions; treat red phases as supervised beats.
- [ ] Deliverable is a findings log (misread prompts, missed halts, skill-text
      drift vs the binary), not pass/fail.

## Cross-cutting assertions (check continuously)

- [ ] `next` and `status` never mutate: `git log` hash +
      `git status     --porcelain` identical before/after every call.
- [ ] Every refusal/error in `--json` mode is the envelope
      `{"state":"error","prompt":…}`, single line, exit 1.
- [ ] `actor` is the only loop signal — no `autoAdvance` field anywhere;
      agent-actor JSON prompts carry **no** pinned tail text.
- [ ] Idempotence at every rest: re-running the awaited mutator → zero new
      commits, exit 0; the wrong mutator → zero commits, exit non-zero.
- [ ] `commits`/`actions` arrays are oldest→newest and match `git log`.
- [ ] Prompt quality (the point of live-agent execution): each prompt was
      sufficient for claude to act correctly without extra context — note any
      prompt the agent misread, and any place it violated the "never touch
      `.gtd/` except the granted file" rule.
