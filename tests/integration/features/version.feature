@live
Feature: gtd --version prints the version of the package it runs from

  The built bundle sits one directory below the package root, where the source
  sits deeper. The bundle must still print the root `package.json`'s exact
  version. `Install.test.ts` pins the same for the source layout.

  Scenario: the bundle's --version prints this package's version
    Given a test project
    When I run gtd with "--version"
    Then it succeeds
    And stdout is the gtd version under test
