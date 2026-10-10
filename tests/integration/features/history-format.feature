@inmem
Feature: History format — replay reads only the history formats it knows

  Every commit gtd writes carries a `Gtd-Format: <n>` trailer naming the
  history format it was written in. A commit without one predates the trailer
  and is format 1. A history in a format this gtd does not read is refused
  up front with exit 1 and a message naming both formats — never reported as
  the workflow having changed under the process.

  Background:
    Given a test project
    And the workflow

  Scenario: a landing writes the current format
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"
    And the last commit body contains "Gtd-Format: 1"

  Scenario: a history written before the trailer existed replays as format 1
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And the working tree is committed with message:
      """
      gtd(human): idle → unwind

      Gtd-Step: idle#1
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "unwind"

  # The commit below would also diverge: only the format gate explains the refusal.
  Scenario: a history in an unsupported format is refused, never reported as divergence
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And the working tree is committed with message:
      """
      gtd(agent): elsewhere → review

      Gtd-Step: elsewhere#1
      Gtd-Format: 2
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains "is written in history format 2, but this gtd reads format 1"
    And stderr does not contain "the workflow changed under this process"
