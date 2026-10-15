Feature: gtd strays — files a range touched outside an allowlist

  `gtd strays <base>..<tip> [<glob>...]` lists every file the range's committed
  net diff touched that no glob matches. stdout carries the sorted JSON array
  alone; stderr carries the commentary. Exit 10 means strays were found — no
  other command exits 10. It runs in any git repository: no process underway,
  no gtd.config.ts.

  Background:
    Given a test project
    And I mark the current commit as "boundary"

  @inmem
  Scenario: every touched file inside the allowlist exits 0 with an empty array
    Given a commit "add source" that adds "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd with args "strays boundary..HEAD src/**"
    Then the exit code is 0
    And stdout is:
      """
      []
      """
    And stderr contains "gtd strays: no strays — 1 touched files, all inside the allowlist"

  @inmem
  Scenario: committed files outside the globs are the sorted strays, exit 10
    Given a commit "add source" that adds "src/a.ts" with:
      """
      export const a = 1
      """
    And a commit "add notes" that adds "notes/z.md" with:
      """
      z
      """
    And a commit "add changelog" that adds "CHANGES.md" with:
      """
      c
      """
    When I run gtd with args "strays boundary..HEAD src/** --verbose"
    Then the exit code is 10
    And stdout is:
      """
      ["CHANGES.md","notes/z.md"]
      """
    And stderr contains "stray: \"CHANGES.md\""
    And stderr contains "stray: \"notes/z.md\""
    And stderr contains "gtd strays: 2 of 3 touched files outside the allowlist"

  @inmem
  Scenario: a deleted file and a rename report the deleted path and both rename paths
    Given a file "old.txt" with:
      """
      content
      """
    And the working tree is committed
    And I mark the current commit as "before"
    And the file "old.txt" is deleted
    And a file "new.txt" with:
      """
      content
      """
    And the file "README.md" is deleted
    And the working tree is committed
    When I run gtd with args "strays before..HEAD"
    Then the exit code is 10
    And stdout is:
      """
      ["README.md","new.txt","old.txt"]
      """

  @inmem
  Scenario: a file changed and then restored within the range is not reported
    Given a commit "change readme" that adds "README.md" with:
      """
      changed
      """
    And a commit "restore readme" that adds "README.md" with:
      """
      # test project
      """
    When I run gtd with args "strays boundary..HEAD"
    Then the exit code is 0
    And stdout is:
      """
      []
      """

  @inmem
  Scenario: uncommitted working-tree changes outside the globs are ignored
    Given a file "stray.txt" with:
      """
      not committed
      """
    And "README.md" is modified to:
      """
      edited but not committed
      """
    When I run gtd with args "strays boundary..HEAD"
    Then the exit code is 0
    And stdout is:
      """
      []
      """

  @inmem
  Scenario: with no globs every touched file is a stray
    Given a commit "add source" that adds "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd with args "strays boundary..HEAD"
    Then the exit code is 10
    And stdout is:
      """
      ["src/a.ts"]
      """

  @inmem
  Scenario: an empty range touches nothing
    When I run gtd with args "strays boundary..boundary"
    Then the exit code is 0
    And stdout is:
      """
      []
      """
    And stderr contains "0 touched files"

  @inmem
  Scenario: * stays within a segment, ** crosses them, and a dotfile matches *
    Given a commit "add nested" that adds "src/deep/a.ts" with:
      """
      a
      """
    And a commit "add top" that adds "src/b.ts" with:
      """
      b
      """
    And a commit "add dotfile" that adds ".env" with:
      """
      e
      """
    When I run gtd with args "strays boundary..HEAD src/*.ts *"
    Then the exit code is 10
    And stdout is:
      """
      ["src/deep/a.ts"]
      """
    When I run gtd with args "strays boundary..HEAD src/** *"
    Then the exit code is 0
    And stdout is:
      """
      []
      """

  @inmem
  Scenario: it runs with no gtd.config.ts and no process underway
    Then "gtd.config.ts" does not exist
    When I run gtd with args "strays boundary..HEAD"
    Then the exit code is 0

  @inmem
  Scenario: an unknown revision exits 1 with nothing on stdout
    When I run gtd with args "strays nope..HEAD"
    Then the exit code is 1
    And stdout is empty
    And stderr contains "unknown revision 'nope'"

  @inmem
  Scenario: a missing range or one without .. is a usage error
    When I run gtd with args "strays"
    Then the exit code is 2
    And stdout is empty
    When I run gtd with args "strays boundary"
    Then the exit code is 2
    And stdout is empty

  @inmem
  Scenario: --json prints the same array and an unknown revision becomes the error envelope
    Given a commit "add source" that adds "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd with args "strays boundary..HEAD --json"
    Then the exit code is 10
    And stdout is:
      """
      ["src/a.ts"]
      """
    When I run gtd with args "strays nope..HEAD --json"
    Then the exit code is 1
    And stdout is empty
    And stderr contains "\"state\":\"error\""
