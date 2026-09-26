Feature: build.health.judge/packages.item.health.judge never manufacture "identical" from two unusably-cut tails

  `.gtd/packages/03-bundled-judge-gates.md` Requirement A: `it.tail`'s own
  line-boundary bound can render `""` for a document whose last cut bytes
  hold no full line — a single long unbroken failure line, a minified
  reporter output, a big snapshot. Reading two such empty tails as proof the
  round is unchanged would end the retry loop on evidence nobody saw. The
  gate instead computes a guard from the UNBOUNDED reads and, when it fires,
  replaces `current`/`previous` in `state` with a sentinel and forbids the
  `identical` answer in `criteria` — the routing on the verdict is untouched,
  so escalation still depends on the model's own verdict.

  @inmem
  Scenario: a judgeBudgetBytes too small for either tail to keep a full line forbids identical instead of reading two empty strings as sameness
    Given a test project
    And the workflow
    And an environment variable "GTD_JUDGEBUDGETBYTES" set to "4"
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the precheck failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/attempt.ts" with:
      """
      export const attempt = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    # Both red rounds' reports fabricated directly, exactly as `check`'s own
    # real script would have left them (stamped, red) — `gtd land` only
    # replays the flow over each diff, it never re-runs the script. The first
    # red round's report is what `build.health.judge` reads as `previous`.
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 1 failed
      <!-- gtd check abc1234 -->
      """
    And gtd lands "gtd(check): build.health.check → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/attempt.ts" with:
      """
      export const attempt = 2
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 2 failed
      <!-- gtd check def5678 -->
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.health.judge"

    # At `judgeBudgetBytes: 4`, `it.tail(path, 0.5)` keeps only the last 2
    # bytes of either file — the stamp's own trailing `>\n` — which has no
    # full line left in it, so both tails render "".
    When I run gtd with args "judge"
    Then it succeeds
    And stdout contains "tailsNotComparable"

  # `.gtd/packages/02-judge-gate-soundness.md` Requirement "Matching tails can
  # hide a health failure": two reports of EQUAL byte length that differ
  # before the cut but match after it must not read as `identical` — the
  # guard now compares the two WHOLE (stamp-stripped) reads, not their length.
  @inmem
  Scenario: two equal-length reports that differ before the cut but match after it forbid identical instead of escalating on a false match
    Given a test project
    And the workflow
    And an environment variable "GTD_JUDGEBUDGETBYTES" set to "90"
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the precheck failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/attempt.ts" with:
      """
      export const attempt = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt one failed here
      shared tail line
      <!-- gtd check abc1234 -->
      """
    And gtd lands "gtd(check): build.health.check → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/attempt.ts" with:
      """
      export const attempt = 2
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt two failed here
      shared tail line
      <!-- gtd check def5678 -->
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.health.judge"

    When I run gtd with args "judge"
    Then it succeeds
    And stdout contains "tailsNotComparable"

  @inmem
  Scenario: two genuinely identical reports still reach the identical verdict and escalate
    Given a test project
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the precheck failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/attempt.ts" with:
      """
      export const attempt = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the same failure, restated
      <!-- gtd check abc1234 -->
      """
    And gtd lands "gtd(check): build.health.check → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/attempt.ts" with:
      """
      export const attempt = 2
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the same failure, restated
      <!-- gtd check def5678 -->
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.health.judge"

    When I run gtd judge answer with stdin:
      """
      [{"id":"verdict","answer":"identical","p":0.99}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.health.judge → build.health.escalate"
