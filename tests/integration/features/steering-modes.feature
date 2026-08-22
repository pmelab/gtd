Feature: Pluggable steering-file modes — a mode is a format command plus a validate command

  A state's `mode:` names a steering-file MODE (see STATES.md §12 and
  docs/design/pluggable-steering-modes.md): a `format:` and/or `validate:` shell
  command, declared in a `modes:` map — either inside `workflow:` or as the
  top-level `.gtdrc` `modes:` layer over it. Each command is an Eta template
  with `it.file` bound to the rendered steering-file path, run via bash;
  `format` rewrites the file in place, `validate` exits 0 for valid and
  non-zero with its output as the findings.

  The two halves resolve INDEPENDENTLY. Under them sit gtd's two BUILT-IN
  VALIDATORS, `qa` (src/OpenQuestions.ts) and `review` (src/ReviewDoc.ts) —
  available unnamed in every workflow, and kept if a `modes:` entry declares
  only a `format:`. gtd ships NO formatter, so a mode formats nothing until a
  project plugs one in.

  Both halves run wherever the gate runs: `gtd validate`, and the `gtd land`
  capture gate that refuses to commit an invalid steering file. The bulk of
  this feature runs `@live` (real subprocess execution over real bash); five
  scenarios are ALSO covered `@inmem` (tagged "(scripted)") over a scripted
  `CommandRunner` double, since real bash is unreachable against an in-memory
  worktree — added, not converted, so a spawn-mechanism difference still has
  something to fail against.

  @live
  Scenario: gtd validate reports a custom mode's validate command as findings and exits non-zero
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            validate: |
              status=0
              grep -q '^## Status' <%= it.file %> || {
                echo "<%= it.file %>: missing a '## Status' section"
                status=1
              }
              grep -q '^## Decision' <%= it.file %> || {
                echo "<%= it.file %>: missing a '## Decision' section"
                status=1
              }
              exit $status
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd

      ## Status

      Accepted.
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains ".gtd/docs/adr.md is not valid"
    And stderr contains ".gtd/docs/adr.md: missing a '## Decision' section"
    And stderr does not contain "missing a '## Status' section"

  @inmem
  Scenario: gtd validate reports a custom mode's validate command as findings and exits non-zero (scripted)
    # The @inmem twin of the scenario above: real bash is unreachable against an
    # in-memory worktree, so the validate command is a scripted double keyed by
    # its rendered command string (see tests/integration/support/steps/steering.steps.ts).
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            validate: "adr-validate <%= it.file %>"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And the shell command "adr-validate .gtd/docs/adr.md" exits 1 with:
      """
      .gtd/docs/adr.md: missing a '## Decision' section
      """
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains ".gtd/docs/adr.md is not valid"
    And stderr contains ".gtd/docs/adr.md: missing a '## Decision' section"
    And stderr contains "does not pass"

  @live
  Scenario: gtd validate exits 0 when the custom mode's validate command is happy
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            validate: "grep -q '^## Decision' <%= it.file %>"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd

      ## Decision

      Adopt it.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/docs/adr.md: valid"

  @inmem
  Scenario: gtd validate exits 0 when the custom mode's validate command is happy (scripted)
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            validate: "adr-validate <%= it.file %>"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And the shell command "adr-validate .gtd/docs/adr.md" exits 0 with:
      """
      ok
      """
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd

      ## Decision

      Adopt it.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/docs/adr.md: valid"

  @live
  Scenario: the mode's format command rewrites the file in place before validation
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            format: "sed 's/^status: draft$/status: accepted/' <%= it.file %> > <%= it.file %>.tmp && mv <%= it.file %>.tmp <%= it.file %>"
            validate: "grep -q '^status: accepted$' <%= it.file %>"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
      # Validation therefore passes only because formatting ran FIRST, in place.
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd

      status: draft
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/docs/adr.md: valid"
    And the git status contains ".gtd/docs/adr.md"

  @inmem
  Scenario: the mode's format command rewrites the file in place before validation (scripted)
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            format: "adr-format <%= it.file %>"
            validate: "adr-validate <%= it.file %>"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And the shell command "adr-format .gtd/docs/adr.md" rewrites ".gtd/docs/adr.md" to:
      """
      # ADR 1: use gtd

      status: accepted
      """
    And the shell command "adr-validate .gtd/docs/adr.md" exits 0 with:
      """
      ok
      """
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd

      status: draft
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/docs/adr.md: valid"
    And ".gtd/docs/adr.md" contains "status: accepted"
    And the git status contains ".gtd/docs/adr.md"

  @live
  Scenario: the gtd land capture gate refuses a turn whose custom-mode steering file is invalid
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            validate: |
              grep -q '^## Decision' <%= it.file %> || {
                echo "<%= it.file %>: an ADR needs a '## Decision' section"
                exit 1
              }
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd
      """
    And a file ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd

      ## Stauts

      Accepted.
      """
    When I run gtd land
    Then it fails
    # The step's own required script runs the mode's validate command ahead of
    # its commit, so the refusal IS that command's non-zero exit and output —
    # nothing is committed.
    And stderr contains "an ADR needs a '## Decision' section"
    And the last commit subject is "gtd(human): drafting"

  @inmem
  Scenario: the gtd land capture gate refuses a turn whose custom-mode steering file is invalid (scripted)
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            validate: "adr-validate <%= it.file %>"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And the shell command "adr-validate .gtd/docs/adr.md" exits 1 with:
      """
      .gtd/docs/adr.md: an ADR needs a '## Decision' section
      """
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd
      """
    And a file ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd

      ## Stauts

      Accepted.
      """
    When I run gtd land
    Then it fails
    # The step's own required script runs the mode's validate command ahead of
    # its commit, so the refusal IS that command's non-zero exit and output —
    # nothing is committed.
    And stderr contains "an ADR needs a '## Decision' section"
    And the last commit subject is "gtd(human): drafting"

  @live
  Scenario: a valid custom-mode steering file passes the gate and the turn is captured
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            validate: "grep -q '^## Decision' <%= it.file %>"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd
      """
    And a file ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd

      ## Decision

      Adopt it.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): drafting → idle"

  @live
  Scenario: a failing format command is a hard error — the file is never judged, nothing is committed
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            format: |
              echo "adr-fmt: cannot parse <%= it.file %>" >&2
              exit 3
            validate: "true"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd
      """
    And a file ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd (edited)
      """
    When I run gtd land
    Then it fails
    # `format:` comes first in the emitted script and the script runs under
    # `set -e`, so a non-zero format exit stops it before the validate command
    # or the commit is ever reached — and its status is the script's own.
    And the exit code is 3
    And stderr contains "adr-fmt: cannot parse .gtd/docs/adr.md"
    And the last commit subject is "gtd(human): drafting"

  @inmem
  Scenario: a failing format command is a hard error — the file is never judged, nothing is committed (scripted)
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            format: "adr-format-broken <%= it.file %>"
            validate: "adr-validate-never-runs <%= it.file %>"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And the shell command "adr-format-broken .gtd/docs/adr.md" exits 3 with:
      """
      adr-fmt: cannot parse .gtd/docs/adr.md
      """
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd
      """
    And a file ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd (edited)
      """
    When I run gtd land
    Then it fails
    # `format:` comes first in the emitted script and the script runs under
    # `set -e`, so a non-zero format exit stops it before the validate command
    # or the commit is ever reached.
    And stderr contains "exited 3"
    And stderr contains "adr-fmt: cannot parse .gtd/docs/adr.md"
    And stderr does not contain "adr-validate-never-runs"
    And the last commit subject is "gtd(human): drafting"

  @live
  Scenario: a modes: entry named after a built-in overrides only the half it declares
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          qa:
            validate: |
              grep -q '^## Open Questions' <%= it.file %> || {
                echo "<%= it.file %>: my house rule — every plan lists its open questions"
                exit 1
              }
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": grilling
              grilling:
                actor: agent
                prompt: "Draft the plan."
                file: TODO.md
                mode: qa
                on:
                  "* **": idle
      """
      # gtd's own open-questions parser accepts this file (no "## Open
      # Questions" section at all is trivially valid to it) — the workflow's
      # own command does not, which is how we can tell the declared `validate:`
      # displaced the built-in parser.
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing. Plan: add src/thing.ts.
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains "my house rule"

  @live
  Scenario: declaring only a format: for a built-in mode KEEPS gtd's own validation
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          qa:
            format: "sed -i.bak 's/[[:space:]]*$//' <%= it.file %> && rm -f <%= it.file %>.bak"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": grilling
              grilling:
                actor: agent
                prompt: "Draft the plan."
                file: TODO.md
                mode: qa
                on:
                  "* **": idle
      """
      # The mode declares a formatter and no validator, so gtd's open-questions
      # parser still runs — and still rejects an `### ` question heading with
      # no question text.
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing.

      ## Open Questions

      ###

      No question text on the heading.
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains "has no question text"

  @live
  Scenario: a top-level modes: key plugs a formatter into a workflow without re-declaring its modes
    # The top-level `modes:` layer sits BESIDE `workflow:` — the workflow's
    # `grilling` state declares `file: TODO.md` + `mode: qa` but no `modes:`
    # of its own, so the project brings its own formatter for that mode via the
    # top-level key, and gtd's own built-in qa validation still runs underneath.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        qa:
          format: "sed 's/  */ /g' <%= it.file %> > <%= it.file %>.tmp && mv <%= it.file %>.tmp <%= it.file %>"
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": grilling
              grilling:
                actor: agent
                file: TODO.md
                mode: qa
                prompt: "plan"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing.    Plan: add src/thing.ts.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/TODO.md: valid"
    And ".gtd/TODO.md" contains "Build a thing. Plan: add src/thing.ts."

  @live
  Scenario: a top-level modes: entry layers over the workflow's own, half by half
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr:
          format: "sed 's/^status: draft$/status: accepted/' <%= it.file %> > <%= it.file %>.tmp && mv <%= it.file %>.tmp <%= it.file %>"
      workflow:
        modes:
          adr:
            validate: "grep -q '^status: accepted$' <%= it.file %>"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
      # Validation passes only because both halves survived the merge and ran in order.
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      status: draft
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/docs/adr.md: valid"

  @live
  Scenario: a custom mode declaring only format: formats the file and has nothing to validate
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            format: "sed 's/draft/DRAFT/' <%= it.file %> > <%= it.file %>.tmp && mv <%= it.file %>.tmp <%= it.file %>" # no validate: — that half is a no-op
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      status: draft
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/docs/adr.md: valid"
    And ".gtd/docs/adr.md" contains "status: DRAFT"

  @live
  Scenario: a format-only custom mode at a first-write beat now emits a script (the guard plus the format command), not "nothing to validate"
    # Package 2, Requirement A/B combined: before this package, an absent
    # steering file short-circuited to "nothing to validate" in TS-land — a
    # format-only mode (no in-process parser at all, so no round-trip and no
    # skip notice either) now still gets a real script: the existence guard
    # plus its own format: command, evaluated once the script actually runs.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            format: "sed 's/draft/DRAFT/' <%= it.file %> > <%= it.file %>.tmp && mv <%= it.file %>.tmp <%= it.file %>"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And an empty commit "gtd(human): drafting"
    When I run gtd next with "--sh"
    Then it succeeds
    # gtd_validate's own value is itself shell-quoted for --sh (every literal
    # `'` inside it becomes the POSIX `'\''` escape), so the guard/format
    # command are matched by their quote-independent substrings.
    And stdout contains "gtd_validate="
    And stdout contains "-f "
    And stdout contains ".gtd/docs/adr.md"
    And stdout contains "] || exit 0"
    And stdout contains "sed "
    And stdout contains "draft/DRAFT"
    And stdout does not contain "CONFIGURATION BUG"
    And stdout does not contain "skipping the format/validate contradiction check"

  @inmem
  Scenario: the answer-completeness gate still fires on a qa-mode state even when its validate: command is overridden
    # The semantic upgrade: the gate asks steeringCapabilities for the FORMAT
    # (qa's identity, from the name), not for "is this mode's validator gtd's
    # own parser" — so a workflow that plugs a shell command into qa's
    # validate: still gets the open-questions answer gate. The command below
    # always exits 0 (a house rule gtd itself has nothing to say about), yet
    # the step is still refused because a question in the file is unanswered.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          qa:
            validate: "true"
        entry:
          default: root
        machines:
          root:
            entry: drafting
            states:
              drafting:
                actor: agent
                prompt: "Draft the plan."
                file: TODO.md
                mode: qa
                on:
                  "* **": answering
              answering:
                actor: human
                message: "Answer the open questions."
                file: TODO.md
                mode: qa
                answerGate: true
                on:
                  "* **": drafting
      """
    And the shell command "true" exits 0 with:
      """
      """
    And a commit "gtd(agent): answering" that adds ".gtd/TODO.md" with:
      """
      Build a thing.

      ## Open Questions

      ### Which API?

      - [ ] REST
      - [ ] GraphQL
      """
    And a file ".gtd/TODO.md" with:
      """
      Build a thing. (still deciding)

      ## Open Questions

      ### Which API?

      - [ ] REST
      - [ ] GraphQL
      """
    When I run gtd land
    Then it fails
    And stderr contains "1 open question(s)"
    And stderr contains "not answered at \"answering\""
    And the last commit subject is "gtd(agent): answering"

  @live
  Scenario: a seeded validate: command's bare "gtd" resolves to the build under test
    # SteeringFormats.ts's seededValidateCommand renders as the literal
    # `gtd check <mode> '<file>'` — resolving `gtd` BY NAME off $PATH rather
    # than by absolute path, trading PATH independence for readability. This
    # proves the @live tier's PATH shim (world.ts's pathShimDir, wired up by
    # hooks.ts's Before/After) makes that bare `gtd` resolve to THIS build
    # under test, never a stray globally-installed gtd.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            validate: |
              v=$(gtd version)
              echo "path-shim: $v"
              exit 1
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start a decision record"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                prompt: "Write the ADR."
                file: docs/adr.md
                mode: adr
                on:
                  "* **": idle
      """
    And a commit "gtd(human): drafting" that adds ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains "path-shim:"
    And stderr contains the gtd version under test

  # ── The mode-contradiction round-trip (package 2, Requirement B) ──────────
  # A mode whose declared `format:` breaks its own validator is a config bug
  # gtd can detect mechanically: format a copy of the built-in format's own
  # canonical sample, re-validate it with `gtd check <mode>`, and fail loudly
  # BEFORE the real steering file's own findings are ever reported. Coverage
  # is the two built-in modes only (`qa`/`review`) — the fixture pairs one of
  # them with a deliberately hostile one-liner `format:`, never a synthetic
  # mode, and never a real formatter binary.

  @live
  Scenario: a built-in mode paired with a format: that breaks its own validator is caught before any real file exists
    # The hostile one-liner rewrites every "- [ ]" review hunk marker to
    # "* [ ]" — REVIEW_FORMAT's parser only recognizes a hunk pointer that
    # starts with "- [", so the round-trip's re-validation finds the
    # reformatted sample invalid. No `.gtd/REVIEW.md` is ever written in this
    # scenario — the whole point is that the check still fires at this
    # first-write beat, ahead of `fileExistsGuard`.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          review:
            format: "sed -i.bak 's/^- \\[/* [/' <%= it.file %> && rm -f <%= it.file %>.bak"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": reviewing
              reviewing:
                actor: agent
                file: REVIEW.md
                mode: review
                prompt: "review"
                on:
                  "* **": idle
      """
    And an empty commit "gtd(human): reviewing"
    When I run gtd with args "validate"
    Then it fails
    And stderr contains "mode \"review\""
    And stderr contains "CONFIGURATION BUG"
    And stderr contains "Do NOT edit the steering file"
    And stderr contains "sed -i.bak"
    # No file findings alongside it — the round-trip aborts the script before
    # the real file's own format:/validate: commands ever run.
    And stderr does not contain "Chunk"
    And stderr does not contain "REVIEW.md has no"

  @live
  Scenario: the same repo with the formatter removed exits 0 — no contradiction to find
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
                message: "start"
                on:
                  "* **": reviewing
              reviewing:
                actor: agent
                file: REVIEW.md
                mode: review
                prompt: "review"
                on:
                  "* **": idle
      """
    And an empty commit "gtd(human): reviewing"
    When I run gtd with args "validate"
    Then it succeeds

  @live
  Scenario: a mode carrying only a user validate: command prints that the contradiction check was skipped, loudly
    # Coverage is the two built-in modes only, so a genuine user `validate:`
    # override has no in-process parser to round-trip a sample through — the
    # emitted script prints a one-line skip notice instead of silently saying
    # nothing (silence would read as a clean bill of health). Inspected via
    # the unexecuted `gtd next --sh` script text rather than a live run: the
    # notice prints to stderr, and a SUCCESSFUL script's stderr is exactly
    # the thing `gtd validate`'s own driving harness discards once the
    # script exits 0 (see world.ts's validateVerdict) — the raw script text
    # is the deterministic way to prove the line is really there.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          review:
            format: "true"
            validate: "true"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": reviewing
              reviewing:
                actor: agent
                file: REVIEW.md
                mode: review
                prompt: "review"
                on:
                  "* **": idle
      """
    And an empty commit "gtd(human): reviewing"
    When I run gtd next with "--sh"
    Then it succeeds
    And stdout contains "gtd_validate="
    And stdout contains "mode \"review\" has an external validate: command"
    And stdout contains "skipping the format/validate contradiction check"
