@inmem
Feature: a bad sliceMaxCriteria refuses the landing that would pin it

  The cap is read right after idle, so a value that is not a positive integer
  never gets pinned into a process that would refuse every later landing.

  Scenario: a zero cap refuses the idle landing
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_SLICEMAXCRITERIA" set to "0"
    And a file "TODO.md" with:
      """
      # Something
      """
    Then driving the process is refused with "sliceMaxCriteria must be a positive integer, got \"0\""
