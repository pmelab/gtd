Feature: gtd judge / gtd judge answer — the judgment surface's CLI plumbing

  `.gtd/packages/01-judgment-surface.md` Task 4: `gtd judge` is a read-only
  peek at the resolved rest's pending judgment (the same `judge` field
  `gtd next --json` already carries); `gtd judge answer` reads a verdict off
  stdin and decodes it against an Effect Schema built from the pending
  judgment's own question ids. Both refuse through the ordinary error
  envelope when the resolved rest declares no `judge:`. `gtd judge answer
  --json=script` (Task 5) writes the `Gtd-Judge:` trailer on the step commit.

  Task 6 adds the human fallback: a judge state is an ordinary `message` rest
  with a plain `"C"` (clean-tree) edge to its own conservative target, no
  `routes:` engine involved. Landing it with no `gtd judge answer` ever run
  is indistinguishable from any other clean-tree human gate at the routing
  level — it just follows the "C" edge — but carries no `Gtd-Judge:` trailer,
  which is the only signal telling a skipped judgment apart from one answered
  conservatively.

  @inmem
  Scenario: gtd judge prints the rendered judgment, without mutating anything
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "hi"
                judge: '{"state":"idle","questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}'
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "go"
                on:
                  "* **": idle
      """
    When I run gtd with args "judge"
    Then it succeeds
    And stdout contains "q1"
    And the last commit subject is "chore: add .gtdrc"

  @inmem
  Scenario: gtd judge refuses through the ordinary error envelope when the resolved rest declares no judge:
    Given a test project
    And the workflow
    When I run gtd with args "judge"
    Then it fails
    And stdout is empty
    And stderr contains "declares no"

  @inmem
  Scenario: gtd judge answer decodes a verdict piped on stdin, against the pending question ids
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "hi"
                judge: '{"state":"idle","questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}'
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "go"
                on:
                  "* **": idle
      """
    When I run gtd with args "judge answer" and stdin:
      """
      [{"id":"q1","answer":true,"p":0.97}]
      """
    Then it succeeds

  @inmem
  Scenario: gtd judge answer refuses when the piped verdict names a question the pending judgment never declared
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "hi"
                judge: '{"state":"idle","questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}'
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "go"
                on:
                  "* **": idle
      """
    When I run gtd with args "judge answer" and stdin:
      """
      [{"id":"not-a-real-question","answer":true,"p":0.97}]
      """
    Then it fails
    And stderr contains "does not match the pending questions"

  @live
  Scenario: gtd judge answer decodes a verdict piped into a REAL gtd subprocess
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "hi"
                judge: '{"state":"idle","questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}'
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "go"
                on:
                  "* **": idle
      """
    When I run gtd with args "judge answer" and stdin:
      """
      [{"id":"q1","answer":true,"p":0.97}]
      """
    Then it succeeds

  @inmem
  Scenario: a judgment skipped entirely lands on the state's own conservative "C" edge, with no Gtd-Judge: trailer
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": review
              review:
                actor: human
                judge: '{"state":"review","questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}'
                message: "run `gtd judge answer` and paste a verdict, or land with a clean tree to accept the conservative default"
                on:
                  "C": conservative
              conservative:
                actor: agent
                prompt: "the conservative path"
                on:
                  "* **": idle
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"

    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → review"

    # Land the judge rest with a clean tree and no `gtd judge answer` ever
    # run — no `Gtd-Judge:` trailer exists anywhere in this process's
    # history, so this is the SKIPPED case, not one answered conservatively.
    # It still lands on the state's ordinary "C" edge like any other
    # clean-tree human gate: no engine change, no routes: involved.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): review → conservative"
    And the last commit body does not contain "Gtd-Judge:"

  # `.gtd/packages/01-judgment-surface.md` Task 7: the judged-retry shape,
  # standalone from `src/workflows/unified.yaml`'s own `healthGate` (pinned
  # separately by `src/workflows/templates.test.ts`) — a `check` actor red
  # edge lands on `judge` only once a PRIOR round exists, `judge` carries
  # `routes:` (identical -> escalate, catch-all -> fixing) alongside an
  # ordinary `C` row to the SAME catch-all target, and `fixing` carries the
  # hard `retry` cap. Both scenarios below share this workflow: the acceptance
  # criterion's own two scenarios ("a driver answers a judge beat and the
  # retry loop ends on an 'identical output' verdict before the cap"; "an
  # unaware driver shows the same beat as a plain message to a human").
  @inmem
  Scenario: an aware driver answers "identical" and the retry loop ends before the cap
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: start
            states:
              start:
                actor: human
                message: "go"
                on:
                  "* **": checking
              checking:
                actor: check
                script: "npm test"
                on:
                  "A .gtd/PRIOR_FEEDBACK.md": judge
                  "M .gtd/PRIOR_FEEDBACK.md": judge
                  "A .gtd/FEEDBACK.md": fixing
                  "M .gtd/FEEDBACK.md": fixing
                  "* **": done
                  "C": done
              judge:
                actor: human
                message: "run `gtd judge answer` and paste a verdict, or land with a clean tree to retry the fix"
                judge: '{"state":"compare .gtd/FEEDBACK.md against .gtd/PRIOR_FEEDBACK.md","questions":[{"id":"verdict","primitive":"choice","instructions":"identical, new-failure, or progress","criteria":"identical: same failure restated"}]}'
                routes:
                  - question: verdict
                    is: identical
                    minP: "0.5"
                    to: escalate
                  - to: fixing
                on:
                  "C": fixing
              fixing:
                actor: agent
                prompt: "fix it"
                retry:
                  max: 2
                  otherwise: escalate
                on:
                  "* **": checking
              escalate:
                actor: human
                message: "stuck"
                on:
                  "* **": done
              done:
                actor: human
                message: "done"
      """
    And a file "NOTE.md" with:
      """
      go
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → checking"

    # Round 1: no prior committed FEEDBACK.md yet — bypasses judge entirely,
    # straight to fixing. The first red round pays for no judgment.
    Given a file ".gtd/FEEDBACK.md" with:
      """
      boom (round 1)
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking → fixing"

    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): fixing → checking"

    # Round 2: a prior committed FEEDBACK.md now exists — checking (the
    # driver, standing in for the check-actor script) writes
    # .gtd/PRIOR_FEEDBACK.md with the SAME content as the fresh FEEDBACK.md,
    # so an aware driver piping this to a judge model would genuinely see
    # "identical".
    Given a file ".gtd/PRIOR_FEEDBACK.md" with:
      """
      boom (round 1)
      """
    And a file ".gtd/FEEDBACK.md" with:
      """
      boom (round 1)
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking → judge"

    # The aware driver answers "identical" — routes: escalates immediately,
    # even though fixing's own retry cap (max: 2) has room for another round.
    When I run gtd judge answer with stdin:
      """
      [{"id":"verdict","answer":"identical","p":0.95}]
      """
    Then it succeeds
    And the last commit subject is "gtd(human): judge → escalate"
    And the last commit body contains "Gtd-Judge:"

  @inmem
  Scenario: an unaware driver never runs `gtd judge answer` — the same judge beat lands as a plain message to a human, on the ordinary conservative edge
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: start
            states:
              start:
                actor: human
                message: "go"
                on:
                  "* **": checking
              checking:
                actor: check
                script: "npm test"
                on:
                  "A .gtd/PRIOR_FEEDBACK.md": judge
                  "M .gtd/PRIOR_FEEDBACK.md": judge
                  "A .gtd/FEEDBACK.md": fixing
                  "M .gtd/FEEDBACK.md": fixing
                  "* **": done
                  "C": done
              judge:
                actor: human
                message: "run `gtd judge answer` and paste a verdict, or land with a clean tree to retry the fix"
                judge: '{"state":"compare .gtd/FEEDBACK.md against .gtd/PRIOR_FEEDBACK.md","questions":[{"id":"verdict","primitive":"choice","instructions":"identical, new-failure, or progress","criteria":"identical: same failure restated"}]}'
                routes:
                  - question: verdict
                    is: identical
                    minP: "0.5"
                    to: escalate
                  - to: fixing
                on:
                  "C": fixing
              fixing:
                actor: agent
                prompt: "fix it"
                retry:
                  max: 2
                  otherwise: escalate
                on:
                  "* **": checking
              escalate:
                actor: human
                message: "stuck"
                on:
                  "* **": done
              done:
                actor: human
                message: "done"
      """
    And a file "NOTE.md" with:
      """
      go
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → checking"

    Given a file ".gtd/FEEDBACK.md" with:
      """
      boom (round 1)
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking → fixing"

    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): fixing → checking"

    Given a file ".gtd/PRIOR_FEEDBACK.md" with:
      """
      boom (round 1)
      """
    And a file ".gtd/FEEDBACK.md" with:
      """
      boom, but different this time (round 2)
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking → judge"

    # The named acceptance scenario itself: "shown as a plain message to a
    # human" means kind: "message" and the message text on stdout — not just
    # a routing outcome an unaware driver happens to also produce.
    When I run gtd next with "--json=kind"
    Then it succeeds
    And stdout matches "^message\n$"
    When I run gtd next
    Then it succeeds
    And stdout contains "run `gtd judge answer` and paste a verdict"

    # An unaware driver ignores `judge:` (per the requirement: "an unaware
    # driver shows the message and the human answers it"), reads only
    # `message:`, and lands with a clean tree — no `gtd judge answer` ever
    # ran. `routes:` never even gets consulted; the ordinary "C" row decides,
    # the SAME conservative target its own catch-all route also names.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): judge → fixing"
    And the last commit body does not contain "Gtd-Judge:"

  # `.gtd/packages/02-judge-actor-and-conservative-catch-all.md` Requirement B:
  # every bundled judge gate declares `actor: judge`, not `human` — no human
  # can answer a judgment. `gtd next --json=actor`/`gtd land` need no engine
  # change to accept the word (`Actor` is a plain string throughout), so this
  # is a plain custom workflow proving the plumbing generically, standalone
  # from the bundled template (pinned separately by
  # `src/workflows/templates.test.ts`).
  @inmem
  Scenario: gtd next --json=actor at a judge gate reports "judge", not "human"
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: verdict
            states:
              verdict:
                actor: judge
                message: "run `gtd judge answer` and paste a verdict, or land to accept the conservative default"
                judge: '{"state":"verdict","questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}'
                on:
                  "* **": done
              done:
                actor: human
                message: "chore: done"
      """
    When I run gtd next with "--json=actor"
    Then it succeeds
    And stdout matches "^judge\n$"

  @inmem
  Scenario: a verdict landed at a judge gate writes a gtd(judge): subject
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: verdict
            states:
              verdict:
                actor: judge
                message: "run `gtd judge answer` and paste a verdict, or land to accept the conservative default"
                judge: '{"state":"verdict","questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}'
                on:
                  "C": done
              done:
                actor: human
                message: "chore: done"
      """
    When I run gtd judge answer with stdin:
      """
      [{"id":"q1","answer":true,"p":0.97}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): verdict → done"
    And the last commit body contains "Gtd-Judge:"

  @inmem
  Scenario: a bare gtd land at a judge gate (no verdict piped) still authenticates as the judge actor — the skipped-judgment path is a judge commit, not a human one
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: verdict
            states:
              verdict:
                actor: judge
                message: "run `gtd judge answer` and paste a verdict, or land to accept the conservative default"
                judge: '{"state":"verdict","questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}'
                on:
                  "C": done
              done:
                actor: human
                message: "chore: done"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): verdict → done"
    And the last commit body does not contain "Gtd-Judge:"

  # `.gtd/packages/03-judgment-inlines-its-evidence.md`: the planning gate's
  # Same package, Task 3: the review fast-path gate (`build.review.pre`) used
  # to ship the judge only `reviewBase` and tell it to `git diff` itself — a
  # judge with no repository can't. `state.diff` now carries the real hunks,
  # tracked and untracked alike (an `add -N`'d untracked file is otherwise
  # invisible to a plain `git diff <base>`).
  @inmem
  Scenario: gtd judge at build.review.pre inlines real diff hunks — a tracked edit AND a brand-new untracked file both show up (03)
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And an empty commit "gtd(check): build.health.check → build.review.pre"
    And a file "src/brand-new.ts" with:
      """
      export const neverAdded = true
      """
    When I run gtd with args "judge"
    Then it succeeds
    And stdout contains "calc.ts"
    And stdout contains "brand-new.ts"
    And stdout contains "neverAdded"
