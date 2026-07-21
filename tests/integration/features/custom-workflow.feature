@inmem
Feature: Configurable workflow — the machine's whole shape from .gtdrc

  The `workflow:` config key carries the full state-machine configuration:
  actors, states (with prompts inline in the file), capture rules, turn and
  routing rules, ladders, conflicts, and entry gates. `extends: default`
  (the default) merges over the built-in machine; `extends: none` builds one
  from scratch. Guards and counter stamps are written in a closed declarative
  vocabulary, compiled and validated at config load — and the commit grammar
  itself derives from the active definition, so custom actors, gates, and
  states steer exactly like built-in ones.

  Scenario: A from-scratch two-state note machine drives entirely from config
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        extends: none
        actors:
          - { name: human, kind: interactive }
        entry:
          - { gate: note }
        states:
          idle:
            kind: prompt
            awaits: human
            prompts: { human: "Nothing to note." }
          noting:
            kind: prompt
            awaits: human
            prompts: { human: "Write your note, then run gtd step human." }
            captureRules:
              - { label: note }
        turnRules:
          - actor: human
            gate: note
            branches:
              - to: { rest: { state: noting, actor: human } }
        fallback:
          - when: { noSteeringFiles: true }
            branches:
              - to: { rest: { state: idle, actor: human } }
      """
    And the working tree is committed as "chore: adopt the note machine"
    # A dirty boundary tree enters at the configured gate...
    Given a file "notes/first.md" with:
      """
      Remember the milk.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): note"
    # ...and the landed turn rests at the custom state with its inline prompt.
    When I run gtd next
    Then it succeeds
    And stdout contains "Write your note, then run gtd step human."
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"noting\""
    And stdout contains "\"actor\":\"human\""
    And stdout contains "\"kind\":\"interactive\""
    # Another dirty tree is another note turn.
    Given a file "notes/second.md" with:
      """
      Remember the eggs.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): note"
    # The default machine's vocabulary is not part of this machine: its
    # actors are not declared...
    When I run gtd step agent
    Then it fails
    And stderr contains "unknown actor 'agent'"
    # ...and its subjects are inert boundary history: `gtd: building` is not
    # a label of THIS machine, so it neither errors nor resolves to a default
    # state — the note machine's own fallback settles the boundary at idle.
    And a commit "gtd: building"
    When I run gtd status
    Then it succeeds
    And stdout contains "State: idle"

  Scenario: extends default — one state's prompt overridden inline, everything else untouched
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          fixing:
            kind: prompt
            awaits: agent
            prompts:
              agent: "CUSTOM FIX PROTOCOL: <%~ it.context.feedbackContent %>"
            captureRules:
              - { label: fixing, consumeFeedback: true }
      """
    And the working tree is committed as "chore: adopt the fixing override"
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd(check): test-failed" that adds ".gtd/FEEDBACK.md" with:
      """
      AssertionError: boom
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "CUSTOM FIX PROTOCOL: AssertionError: boom"
    And stdout does not contain "Spawn a **fix subagent**"
    # The rest of the machine is the default: the build rest still exists.
    When I run gtd status
    Then it succeeds
    And stdout contains "State: fixing"

  Scenario: An invalid workflow config fails loading with a rule-coordinate error
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          lounge:
            kind: prompt
            awaits: butler
      """
    And the working tree is committed as "chore: bad workflow"
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "undeclared actor \"butler\""
