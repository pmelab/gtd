Feature: gtd's own stdout never carries a real ANSI escape byte

  Package 11's guard rail: "ANSI only when stdout is a tty and `NO_COLOR` is
  unset" holds trivially for gtd itself, because gtd's own CLI/rendering path
  (`src/Cli.ts`, `src/program.ts`) never inspects `isatty`/`TERM`/`NO_COLOR`
  for anything IT prints — there is no tty-conditional branch to get wrong.
  Nor do the *scripts it prints* for a driver to run: an outcome statement
  (`src/OutcomeScript.ts`) is a plain `printf` with no colour and no terminal
  detection, so gtd's stdout carries neither a real ESC byte (0x1b) nor the
  source text of one, and neither does the script's own output when a driver
  runs it (`src/OutcomeScript.test.ts` pins that under a real pty).

  Because of that, this feature does not simulate two different terminal
  contexts: gtd's own output has no branch on tty-ness for either tier to
  exercise, so "with a tty and without" is satisfied unconditionally rather
  than by two different terminal simulations — allocating a genuine pty would
  be disproportionate infrastructure for a property gtd's own code has zero
  conditional branching on. The identical scenario below is simply run on
  BOTH execution tiers (`hooks.ts` requires every scenario to carry exactly
  one of `@live`/`@inmem`, so "runs in both" means two copies, one per tag,
  not one untagged scenario): `@live` spawns the real bundled binary through a
  pipe (never a tty), `@inmem` never spawns a process at all
  (`makeCapturingCliIo` captures stdout in-process) — between the two, no
  invocation here ever has a controlling terminal, which is exactly what "gtd
  never branches on tty-ness" predicts: the assertion holds the same way
  regardless.

  Background:
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
                  "* **": checking
              checking:
                actor: check
                script: "echo hi"
                on:
                  "C": idle
      """

  @inmem
  Scenario: no escape sequence appears in gtd's own stdout for a message, a prompt, a script and a land (in-memory tier)
    When I run gtd next
    Then it succeeds
    And stdout contains no ANSI escape sequence

    Given a file "NOTE.md" with:
      """
      a note
      """
    And the working tree is committed as "gtd(human): working"
    When I run gtd with args "next"
    Then it succeeds
    And stdout contains no ANSI escape sequence

    # checking: a script rest (check actor, `script:` field) — `gtd next`
    # prints the script text itself. The tree is already clean (NOTE.md
    # landed above), so this empty commit leaves it clean too — required for
    # the land below to match "checking"'s declared "C" (clean-tree) row.
    And an empty commit "gtd(agent): checking"
    When I run gtd with args "next"
    Then it succeeds
    And stdout contains no ANSI escape sequence

    # `gtd land --json=script` still carries the required/optional
    # outcome-carrying script as a field — the one place ANSI source text
    # could ever have appeared in gtd's own stdout, and no longer does at all
    # now that outcome statements carry no colour codes.
    When I run gtd land with "--json=script"
    Then it succeeds
    And stdout contains no ANSI escape sequence

    # Landing the clean checking rest matches its "C" row and commits back to
    # idle. Plain `gtd land`'s own stdout is one prose sentence now, with no
    # script and no ANSI source text at all — this leg proves the prose
    # itself stays escape-free.
    When I run gtd land
    Then it succeeds
    And stdout contains no ANSI escape sequence

  @live
  Scenario: no escape sequence appears in gtd's own stdout for a message, a prompt, a script and a land (live tier)
    When I run gtd next
    Then it succeeds
    And stdout contains no ANSI escape sequence

    Given a file "NOTE.md" with:
      """
      a note
      """
    And the working tree is committed as "gtd(human): working"
    When I run gtd with args "next"
    Then it succeeds
    And stdout contains no ANSI escape sequence

    # checking: a script rest (check actor, `script:` field) — `gtd next`
    # prints the script text itself. The tree is already clean (NOTE.md
    # landed above), so this empty commit leaves it clean too — required for
    # the land below to match "checking"'s declared "C" (clean-tree) row.
    And an empty commit "gtd(agent): checking"
    When I run gtd with args "next"
    Then it succeeds
    And stdout contains no ANSI escape sequence

    # `gtd land --json=script` still carries the required/optional
    # outcome-carrying script as a field — the one place ANSI source text
    # could ever have appeared in gtd's own stdout, and no longer does at all
    # now that outcome statements carry no colour codes.
    When I run gtd land with "--json=script"
    Then it succeeds
    And stdout contains no ANSI escape sequence

    # Landing the clean checking rest matches its "C" row and commits back to
    # idle. Plain `gtd land`'s own stdout is one prose sentence now, with no
    # script and no ANSI source text at all — this leg proves the prose
    # itself stays escape-free.
    When I run gtd land
    Then it succeeds
    And stdout contains no ANSI escape sequence
