# Example: the full grilling → architecting → decompose → picking → review machine

This is the fuller machine gtd shipped as its bundled default before the bundled
default was drastically simplified (see
[STATES.md §10](../../STATES.md#10-the-bundled-default-workflow) for what ships
today — including the two steering-file validation loops the current default
carries over `.gtd/TODO.md` and `.gtd/REVIEW.md`, which this example's own
`grilling`/`reviewing` phases predate and don't validate). It is preserved here
as a copy-paste-ready `.gtdrc` recipe for anyone who wants the heavier shape
back.

Compared to the simplified bundled default, this machine adds:

- **Two-phase human-in-the-loop planning with Q&A loops** — `grilling` ⇄
  `grilling-answer` develops a product-level plan from `.gtd/TODO.md` one open
  question at a time; `architecting` ⇄ `architecting-answer` repeats the same
  shape for `.gtd/ARCHITECTURE.md`, the technical plan built on top of the
  converged product plan.
- **Task decomposition** — `decompose` turns the converged architecture into an
  ordered set of self-contained task files under `.gtd/tasks/`.
- **The deterministic `picking` queue arbiter** — a `script` state that feeds
  tasks into `.gtd/NEXT.md` one at a time, with a per-task `building` →
  `checking`/`fixing` loop, until the queue empties.
- **Agent-prepared review** — `reviewing` has the agent write `.gtd/REVIEW.md`
  summarizing the full cycle diff for a human to check before `await-review`
  resolves an approval or feedback.
- **A squash finale** — approval at `await-review` moves to `squashing` (the
  agent authors `.gtd/COMMIT_MSG.md`) and then `done`, a `commit:` state that
  squashes the whole cycle into one commit. The simplified bundled default drops
  this: it rests at `idle` on approval instead and leaves every turn commit in
  history for the human to squash (or not) however they choose.

Paste the block below under a top-level `workflow:` key in your own `.gtdrc` (or
`.gtdrc.yaml`) — it's the complete definition, unmodified in content from the
version this example is frozen from, only re-indented to nest under `workflow:`.
See [Configuration](../configuration.md) for the `.gtdrc` schema this slots
into.

## State table

| State                 | Actor | Content | `on`                                                                              | Retry              | Model   |
| --------------------- | ----- | ------- | --------------------------------------------------------------------------------- | ------------------ | ------- |
| `idle` (initial)      | human | message | `* **` → `grilling`                                                               | —                  | —       |
| `grilling`            | agent | prompt  | `* **` → `grilling-answer`                                                        | —                  | `smart` |
| `grilling-answer`     | human | message | `C` → `architecting`; `* **` → `grilling`                                         | —                  | —       |
| `architecting`        | agent | prompt  | `* **` → `architecting-answer`                                                    | —                  | `smart` |
| `architecting-answer` | human | message | `C` → `decompose`; `* **` → `architecting`                                        | —                  | —       |
| `decompose`           | agent | prompt  | `* .gtd/tasks/**` → `picking`                                                     | —                  | —       |
| `picking`             | check | script  | `D .gtd/NEXT.md` → `reviewing`; `* .gtd/NEXT.md` → `building`; `C` → `reviewing`  | —                  | —       |
| `building`            | agent | prompt  | `* **` → `checking`                                                               | —                  | —       |
| `checking`            | check | script  | `A .gtd/FEEDBACK.md` → `fixing`; `M .gtd/FEEDBACK.md` → `fixing`; `C` → `picking` | —                  | —       |
| `fixing`              | agent | prompt  | `* **` → `checking`                                                               | max 3 → `escalate` | —       |
| `escalate`            | human | message | `* **` → `checking`                                                               | —                  | —       |
| `reviewing`           | agent | prompt  | `* .gtd/REVIEW.md` → `await-review`                                               | —                  | `smart` |
| `await-review`        | human | message | `D .gtd/REVIEW.md` → `squashing`; `* **` → `grilling`                             | —                  | —       |
| `squashing`           | agent | prompt  | `A .gtd/COMMIT_MSG.md` → `done`; `M .gtd/COMMIT_MSG.md` → `done`                  | —                  | —       |
| `done`                | —     | commit  | (final — squashes the whole cycle, message read from `.gtd/COMMIT_MSG.md`)        | —                  | —       |

## The `.gtdrc` recipe

````yaml
workflow:
  vars:
    testCommand: npm test

  states:
    idle:
      actor: human
      initial: true
      message: |
        No active gtd cycle.

        To start one: write `.gtd/TODO.md` with a short sketch of what you want
        built — a few sentences is enough — then run `gtd step human`.
      on:
        "* **": grilling

    grilling:
      actor: agent
      # `model` is an opaque harness hint — gtd never interprets this string, it
      # only passes it through to `gtd next --json`/`gtd status --json` so the
      # driving loop can map it onto whatever models its agent harness
      # provides. "smart" here just names the harness-chosen tier for the
      # heavier planning/reviewing turns; states without a `model` use the
      # harness's default.
      model: smart
      prompt: |
        You are an autonomous coding agent. `.gtd/` holds this workflow's own
        state (plans, task specs, review records) — never create, edit, or
        delete anything under `.gtd/` except `.gtd/TODO.md`, which this prompt
        tells you to write.

        `.gtd/TODO.md` holds the plan under development. Read it, then develop
        it into a concrete, product-level plan in this one turn — explore the
        codebase before asking anything, so every open question is one the
        codebase genuinely cannot answer.

        Scope: product and user-facing decisions only. Leave implementation
        details (file/module structure, data models, tech-stack choices) for
        the next phase (`.gtd/ARCHITECTURE.md`).

        For every remaining open question, add it under a `## Open Questions`
        heading, one `### <question>` sub-heading each, with a
        `Suggested default: <answer>` line the human can accept as-is. Omit the
        section entirely once there are none.

        Leave `.gtd/TODO.md` uncommitted and finish your turn — do not commit,
        and do not run `gtd step agent` yourself; the harness does that.
      on:
        "* **": grilling-answer

    grilling-answer:
      actor: human
      message: |
        `.gtd/TODO.md` holds the plan under development, with any open
        questions under `## Open Questions` — each carrying a suggested
        default.

        To answer a question, edit its entry in place (replace
        `Suggested default: ...` with `Answer: ...`, or annotate further), then
        run `gtd step human`.

        To accept all suggested defaults as-is and move on to technical
        architecting, run `gtd step human` with no edits.
      on:
        "C": architecting
        "* **": grilling

    architecting:
      actor: agent
      model: smart
      prompt: |
        You are an autonomous coding agent. `.gtd/` holds this workflow's own
        state — never create, edit, or delete anything under `.gtd/` except
        `.gtd/ARCHITECTURE.md` and `.gtd/TODO.md`, which this prompt tells you
        to write and delete respectively.

        Read `.gtd/TODO.md` (the converged product plan) and develop
        `.gtd/ARCHITECTURE.md` from it in this one turn: file/module structure,
        data models, library/tech-stack choices, error-handling strategy — the
        *how*, building on the *what* already settled. Do not re-open
        product-level decisions from `.gtd/TODO.md`; treat them as settled.

        For every remaining open question, add it under a `## Open Questions`
        heading the same way as the grilling phase (one `### <question>`
        sub-heading, a `Suggested default: <answer>` line). Omit the section
        once there are none.

        Once `.gtd/ARCHITECTURE.md` is written, delete `.gtd/TODO.md` — its
        content has been folded in and it must not linger.

        Leave everything uncommitted and finish your turn.
      on:
        "* **": architecting-answer

    architecting-answer:
      actor: human
      message: |
        `.gtd/ARCHITECTURE.md` holds the technical plan under development, with
        any open questions under `## Open Questions`.

        To answer a question, edit its entry in place, then run
        `gtd step human`.

        To accept all suggested defaults as-is and move on to decomposing the
        work, run `gtd step human` with no edits.
      on:
        "C": decompose
        "* **": architecting

    decompose:
      actor: agent
      prompt: |
        You are an autonomous coding agent. `.gtd/` holds this workflow's own
        state — never create, edit, or delete anything under `.gtd/` except the
        task-spec files this prompt tells you to write (under `.gtd/tasks/`),
        and `.gtd/ARCHITECTURE.md`, which it tells you to delete.

        Read `.gtd/ARCHITECTURE.md` (the converged technical plan) and
        decompose it into an ordered set of self-contained task files under
        `.gtd/tasks/` (e.g. `.gtd/tasks/01-short-name.md`,
        `.gtd/tasks/02-short-name.md`, ...). Order them so the test suite can
        pass again after each one lands; each file is self-contained
        (description, acceptance criteria as `- [ ]` checkboxes, relevant
        paths) since a building turn receives only that one file as context.

        No task file may reference any other `.gtd/` file, or a requirement to
        preserve/update workflow state — `.gtd/` is machine-managed and gets
        cleaned up as the cycle proceeds.

        Once the task files are written, delete `.gtd/ARCHITECTURE.md`. Leave
        everything uncommitted and finish your turn.
      on:
        "* .gtd/tasks/**": picking

    picking:
      actor: check
      script: |
        #!/usr/bin/env bash
        # gtd check turn (the queue arbiter) — the driver (`gtd run`) executes
        # this verbatim, then steps the check actor. Mechanics only: take the
        # first task file (by name) under .gtd/tasks/ into .gtd/NEXT.md, or
        # remove .gtd/NEXT.md when the queue is empty. What NEXT.md's
        # presence/absence MEANS (another task to build vs. the queue closing
        # out to review) is decided by this state's own `on` rules at capture
        # time — never here.
        set +e
        next=$(ls .gtd/tasks/*.md 2>/dev/null | head -n 1)
        if [ -n "$next" ]; then
          printf '%s' "$next" > .gtd/NEXT.md
        else
          rm -f .gtd/NEXT.md
        fi
      on:
        "D .gtd/NEXT.md": reviewing
        "* .gtd/NEXT.md": building
        "C": reviewing

    building:
      actor: agent
      prompt: |
        You are an autonomous coding agent. `.gtd/` holds this workflow's own
        state — never create or edit anything under `.gtd/` except deleting the
        one task file this prompt tells you to delete; never touch
        `.gtd/NEXT.md` yourself — the `picking` state owns it.

        The task file to implement is: <%~ it.read(".gtd/NEXT.md") %>

        Read that file and implement EXACTLY the one task it describes — no
        more, no less; leave every other task file under `.gtd/tasks/`
        untouched. Use TDD discipline: one test, then the implementation that
        passes it, then the next — never write all the tests first.

        Delete the task file once its work is complete and verified. Leave
        everything else uncommitted and finish your turn.
      on:
        "* **": checking

    checking:
      actor: check
      script: |
        #!/usr/bin/env bash
        # gtd check turn — the driver (`gtd run`) executes this verbatim, then
        # steps the check actor. Mechanics only: run the test suite and record a
        # red run's output as .gtd/FEEDBACK.md. What that output MEANS (another
        # fix round vs escalation) is decided by the workflow's own `on`/`retry`
        # rules at capture time — never here.
        #
        # `it.vars.testCommand` defaults to "npm test" (this workflow's own
        # `vars:` above) — override it with a top-level `.gtdrc`
        # `vars: { testCommand: ... }` key, or a `GTD_VAR_testCommand`
        # environment variable (highest precedence).
        set +e
        mkdir -p .gtd
        <%~ it.vars.testCommand %> > .gtd/.check-output 2>&1
        code=$?
        if [ "$code" -ne 0 ]; then
          if [ -s .gtd/.check-output ]; then
            mv .gtd/.check-output .gtd/FEEDBACK.md
          else
            rm -f .gtd/.check-output
            printf 'npm test failed with exit code %s and produced no output.' "$code" > .gtd/FEEDBACK.md
          fi
        else
          rm -f .gtd/.check-output
        fi
      on:
        "A .gtd/FEEDBACK.md": fixing
        "M .gtd/FEEDBACK.md": fixing
        "C": picking

    fixing:
      actor: agent
      retry:
        max: 3
        otherwise: escalate
      prompt: |
        You are an autonomous coding agent. `.gtd/` holds this workflow's own
        state — never create, edit, or delete anything under `.gtd/` except
        `.gtd/FEEDBACK.md`, which this prompt tells you to address.

        Read `.gtd/FEEDBACK.md` (the failing test output) and fix the code so
        the suite passes. Keep the change focused — do not refactor unrelated
        code. If the feedback is wrong, empty or delete `.gtd/FEEDBACK.md`
        instead of "fixing" a non-issue; the machine picks the dispute up
        either way.

        Leave everything uncommitted and finish your turn — do not commit.
      on:
        "* **": checking

    escalate:
      actor: human
      message: |
        The agent could not get the check to pass after repeated attempts.
        `.gtd/FEEDBACK.md` holds the last failing output.

        Investigate and fix it yourself (editing code and/or
        `.gtd/FEEDBACK.md`), then run `gtd step human` to try the check again.
      on:
        "* **": checking

    reviewing:
      actor: agent
      model: smart
      prompt: |
        You are an autonomous coding agent. `.gtd/` holds this workflow's own
        state — never create, edit, or delete anything under `.gtd/` except
        `.gtd/REVIEW.md`, which this prompt tells you to write.

        Write `.gtd/REVIEW.md` to help a human review the cycle's full diff
        (inlined below): group hunks semantically (same feature/refactor/fix,
        even across files), and for each group write a short heading, an
        explanation of what changed and why, and `- [ ] ./path/to/file.ts#42`
        style file pointers (checkboxes are for the human to tick, not you).

        Leave `.gtd/REVIEW.md` uncommitted and finish your turn.
        <% if (it.processDiff.trim()) { %>

        ## Full cycle diff

        ```diff
        <%~ it.processDiff %>
        ```
        <% } %>
      on:
        "* .gtd/REVIEW.md": await-review

    await-review:
      actor: human
      message: |
        `.gtd/REVIEW.md` holds the review record for the completed cycle.

        To approve: delete `.gtd/REVIEW.md` and run `gtd step human`.

        To request changes: edit `.gtd/REVIEW.md` (or the code) with what's
        wrong — including just ticking its checkboxes — then run
        `gtd step human`; this sends the cycle back through grilling with your
        feedback as the new input.
      on:
        "D .gtd/REVIEW.md": squashing
        "* **": grilling

    squashing:
      actor: agent
      prompt: |
        You are an autonomous coding agent. The cycle is approved and done.
        `.gtd/` holds this workflow's own state — never create, edit, or delete
        anything under `.gtd/` except `.gtd/COMMIT_MSG.md`, which this prompt
        tells you to write.

        Write `.gtd/COMMIT_MSG.md` with ONE conventional-commits message for
        the entire cycle (subject line `type(scope): subject`, imperative mood,
        <= 72 characters; a body explaining the why, trade-offs, and key
        decisions). Plain text, no markdown wrapper.

        Leave `.gtd/COMMIT_MSG.md` uncommitted and finish your turn — entering
        this file squashes the whole cycle into one commit using its content as
        the message.
        <% if (it.processDiff.trim()) { %>

        ## Full cycle diff

        ```diff
        <%~ it.processDiff %>
        ```
        <% } %>
      on:
        "A .gtd/COMMIT_MSG.md": done
        "M .gtd/COMMIT_MSG.md": done

    done:
      commit: '<%~ it.read(".gtd/COMMIT_MSG.md") %>'
````

A clean `gtd step human` at `grilling-answer`/`architecting-answer` (the `C`
event) accepts the current phase's draft and moves on; any other pending change
loops back for another round. `picking` is a `script` state whose only job is to
inspect `.gtd/tasks/` (a tree property patterns can't see directly) and turn it
into a diff patterns CAN see — see the walkthrough in
[STATES.md §10](../../STATES.md#10-the-bundled-default-workflow) (the version of
that section frozen alongside this example) for the full state-by-state
narrative, including the `on`-declaration-order subtlety at `picking` and the
`fixing` retry-cap pooling caveat.

## See also

- [docs/design/work-packages.md](../design/work-packages.md) — the arbiter's
  decision record: why the scripted `picking` state (Option A) was chosen over
  the agent-encoded-verdict, tree-predicate-guard, and template-enumeration
  alternatives, plus the process-per-task topology variant.
- [STATES.md](../../STATES.md) — the pattern-machine model this recipe compiles
  against (pattern grammar, resolution, retry, the squash lifecycle).
