@inmem
Feature: gtd runs an each: loop end to end through the real driver protocol

  `.gtd/packages/02-derived-loop-position.md` — an `each:` reference derives
  its loop position purely from history (qualified state names/`Gtd-Each:`
  trailers), with NO beat of its own and NO driver edited: `gtd next --json`
  and `gtd land` see exactly the same `{state, actor, kind, content, edges}`
  shape a non-looping workflow does, just with a qualified `state` string.
  This feature exercises that surface directly (Task 6's own criterion —
  no cucumber feature named `each:` before this one), the item list's
  snapshot-at-entry semantics end to end (a package file written mid-run is
  never built by the already-entered loop — Task 2), an abandon/restore
  round trip re-deriving the identical qualified position (Task 3), a
  `retry:` cap exhausting within one item without touching the next item's
  own budget (.gtd/packages/04-migrate-bundled-loops.md Task 6), and two
  consecutive items resolving to DIFFERENT session ids with a restart
  mid-item re-deriving the SAME one (same task).

  Background:
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
                message: pick
                on:
                  "* **": loop
              loop:
                machine: packageItem
                with:
                  onDrained: finish
                each:
                  glob: '.gtd/packages/*.md'
                  drained: finish
              finish:
                actor: human
                message: done
          packageItem:
            params: [onDrained]
            entry: building
            states:
              building:
                actor: agent
                prompt: build it
                retry:
                  max: 2
                  otherwise: escalate
                on:
                  "* **": $onDrained
              escalate:
                actor: human
                message: stuck
                on:
                  "* **": $onDrained
      """
    And a file ".gtd/packages/a.md" with:
      """
      package a
      """
    And a file ".gtd/packages/b.md" with:
      """
      package b
      """
    And the working tree is committed as "chore: seed two packages"

  Scenario: enters the loop qualified at item 0, snapshotting the item list onto the entering commit
    And a file "NOTE.md" with:
      """
      begin
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → loop[0].building"
    And the last commit body contains "Gtd-Each: loop [\".gtd/packages/a.md\",\".gtd/packages/b.md\"]"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"loop[0].building\""
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "\"kind\":\"prompt\""

  Scenario: a mid-run glob write is not built by the already-entered loop, and the loop drains straight to finish: after item 1
    And a file "NOTE.md" with:
      """
      begin
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → loop[0].building"

    # A package written into the glob's own source directory WHILE the loop
    # is already running — the snapshot already fixed on the entering
    # commit must never grow to include it.
    And a file ".gtd/packages/c.md" with:
      """
      package c (written mid-loop)
      """
    And the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): loop[0].building → loop[1].building"

    And a file "STEP.md" with:
      """
      advance again
      """
    When I run gtd land
    Then it succeeds
    # The reference's own `drained:` target stands once item 1 (the LAST
    # snapshotted item) is done — "loop[2].building" (which would have
    # built c.md) is never a rest.
    And the last commit subject is "gtd(agent): loop[1].building → finish"

  Scenario: an abandon followed by a restore re-derives the identical qualified position
    And a file "NOTE.md" with:
      """
      begin
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → loop[0].building"

    # Deleting NOTE.md doubles as item 0's own dirty-tree trigger AND nets
    # the process's accumulated diff back to empty against the process
    # boundary ("chore: seed two packages") — the same net-zero-diff shape
    # `retained-history.feature` uses so `gtd restore`'s dirty-tree guard
    # never fires below.
    And the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): loop[0].building → loop[1].building"

    When I run gtd next with "--json"
    Then it succeeds
    And I record the json field "state" as "before-abandon"

    When I run gtd with args "abandon"
    Then it succeeds
    When I run gtd with args "restore"
    Then it succeeds

    When I run gtd next with "--json"
    Then it succeeds
    And the json field "state" matches the one recorded as "before-abandon"
    And stdout contains "\"state\":\"loop[1].building\""

  Scenario: a retry: cap exhausts within one item, and the next item starts with a full budget of its own
    And a file "NOTE.md" with:
      """
      begin
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → loop[0].building"

    # building declares no "C" row — landing on a clean tree is an ATTEMPT,
    # counted by retry: like any other entry. max: 2 exhausts on the second
    # attempt and redirects to escalate, entirely within item 0.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): loop[0].building"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): loop[0].building → loop[0].escalate"

    # item 1 has never visited building at all — its own budget is untouched
    # by item 0's cap.
    Given a file "STEP.md" with:
      """
      resolve the escalation
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): loop[0].escalate → loop[1].building"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): loop[1].building"

  Scenario: two consecutive items resolve to DIFFERENT session ids, and a restart mid-item re-derives the SAME one
    And a file "NOTE.md" with:
      """
      begin
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → loop[0].building"

    When I run gtd next with "--json"
    Then it succeeds
    And I record the json field "session.id" as "item 0's session"

    # A restart mid-item — a fresh `gtd next` process, no intervening land —
    # re-derives the identical session purely from history.
    When I run gtd next with "--json"
    Then it succeeds
    And the json field "session.id" matches the one recorded as "item 0's session"

    Given the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): loop[0].building → loop[1].building"

    When I run gtd next with "--json"
    Then it succeeds
    And the json field "session.id" differs from the one recorded as "item 0's session"

  Scenario: a process running two loops in sequence builds every one of the first loop's items, even though the second loop's own list is empty
    # loopA's own `drained:` names loopB's reference directly (the natural way
    # to author "run this loop, then that one") and loopB's glob matches no
    # files at all — `qualifyLoopTarget` chains loopB's empty list straight
    # through to `finish` before loopA's own advance check ever runs; without
    # threading the pre-chain target through, loopA would stop after item 0
    # and item 1 (b.md) would never be built (.gtd/packages/03-each-engine-fixes.md).
    Given a gtd config file at ".gtdrc" with:
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
                message: pick
                on:
                  "* **": loopA
              loopA:
                machine: packageItem
                with:
                  onDrained: loopB
                each:
                  glob: '.gtd/packages/*.md'
                  drained: loopB
              loopB:
                machine: packageItem
                with:
                  onDrained: finish
                each:
                  glob: '.gtd/empty-packages/*.md'
                  drained: finish
              finish:
                actor: human
                message: done
          packageItem:
            params: [onDrained]
            entry: building
            states:
              building:
                actor: agent
                prompt: build it
                on:
                  "* **": $onDrained
      """
    And a file "NOTE.md" with:
      """
      begin
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → loopA[0].building"

    And the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds
    # loopA has a SECOND item (b.md) — loopB's own empty list must not make
    # loopA skip straight to `finish`.
    And the last commit subject is "gtd(agent): loopA[0].building → loopA[1].building"

    And a file "STEP.md" with:
      """
      advance again
      """
    When I run gtd land
    Then it succeeds
    # loopA is now exhausted (item 1 was the last); loopB's own empty list
    # chains straight through to `finish` in the same decision.
    And the last commit subject is "gtd(agent): loopA[1].building → finish"
