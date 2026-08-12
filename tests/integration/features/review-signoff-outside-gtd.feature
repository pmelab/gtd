@live
Feature: Review sign-off reaches build.squashing even when reviewFile lives outside .gtd/ (issue #128)

  `build.review.deciding`'s check script (`src/workflows/unified.yaml`) decides
  sign-off vs. feedback by filtering out the human's own steering-file edit
  before checking whether any OTHER file was hand-edited this round. The
  filter used to assume every steering file lives under `.gtd/` (a hardcoded
  `grep -v '^\.gtd/'`), so a `reviewFile` repointed to the repo root (a `vars:`
  override, e.g. `REVIEW.md`) survived the filter as a "hand-edited code
  file" — misclassifying every clean sign-off as feedback and looping forever
  (build.review.reviewing -> build.review.await-review -> build.review.deciding -> build.review.collecting ->
  build.addressing -> build.health.check -> build.review.reviewing -> ...). The fix additionally
  excludes the state's own `reviewFile` by exact path.

  This scenario actually EXECUTES the rendered script (`I execute the printed
  check script`) rather than simulating its outcome by hand — the bug lives in
  the script's own shell logic, which `@inmem` scenarios never run (see
  AGENTS.md and review-feedback-guards.feature, which simulate this same state
  for the pure-engine routing rules instead).

  Scenario: a clean sign-off (all boxes ticked, no comment, no code edit) reaches build.squashing, not build.review.collecting
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        reviewFile: REVIEW.md
      """
    And a commit "gtd(agent): build.health.check → build.review.reviewing" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1 — new add function
      """
    And a commit "gtd(human): build.review.await-review → build.review.deciding" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1 — new add function
      """
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.squashing"

  # The same sign-off, in a project whose `review` mode declares a `format:`
  # command. A mode's format/validate pair is emitted into the step script ahead
  # of the commit — but this step's whole diff IS the reviewFile's deletion, so
  # there is nothing left to format, and running the formatter anyway made the
  # sign-off UNLANDABLE: `format:` is the first command in a `set -euo pipefail`
  # script, and a real formatter (`prettier --write`, modelled below) exits
  # non-zero on a path that is not there, aborting the script before the commit.
  # A driver saw only a non-zero exit with the failure buried in its log.
  Scenario: the sign-off still lands when the review mode declares a format command that fails on a missing file
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        reviewFile: REVIEW.md
      modes:
        review:
          format: |
            test -f <%= it.file %> || {
              echo "No files matching the pattern were found: <%= it.file %>" >&2
              exit 2
            }
      """
    And a commit "gtd(agent): build.health.check → build.review.reviewing" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1 — new add function
      """
    And a commit "gtd(human): build.review.await-review → build.review.deciding" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1 — new add function
      """
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.squashing"
    And "REVIEW.md" does not exist
