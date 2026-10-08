@inmem
Feature: A package's declared tests gate its build

  A package file lists its tests under `## Tests`, one line each. The build
  turn is refused unless every declared test is in the package's diff — or,
  when the builder writes `.gtd/SATISFIED.md`, already in the tree. The
  fast suite runs right after; `.gtd/ARCHITECTURE.md` survives decompose.

  Background:
    Given a test project
    And the workflow
    And a file "lib/existing.test.ts" with:
      """
      export const existingTest = 1
      """
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Add a widget. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture.author"
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan for the widget. No open questions.
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    And gtd lands "gtd(human): architecture.gate.answer → architecture.decompose.decomposing"

  Scenario: decompose may not delete the architecture document
    Given the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget.
      """
    When I run gtd land
    Then it fails
    And stderr contains "keep .gtd/ARCHITECTURE.md"

  Scenario: a build that leaves a declared test unwritten is refused
    Given a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget.

      ## Tests

      - unit: `lib/widget.test.ts`
      """
    And gtd lands "gtd(agent): architecture.decompose.decomposing → packages.item.building"
    And a file "src/widget.ts" with:
      """
      export const widget = 1
      """
    When I run gtd land
    Then it fails
    And stderr contains "declared-tests"
    And stderr contains "lib/widget.test.ts"

  Scenario: a build that deletes a declared test is refused
    Given a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget.

      ## Tests

      - unit: `lib/existing.test.ts`
      """
    And gtd lands "gtd(agent): architecture.decompose.decomposing → packages.item.building"
    And the file "lib/existing.test.ts" is deleted
    When I run gtd land
    Then it fails
    And stderr contains "declared-tests"
    And stderr contains "lib/existing.test.ts"

  Scenario: a build whose diff holds every declared test advances to the health check
    Given a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget.

      ## Tests

      - unit: `lib/widget.test.ts`
      - e2e: `spec/widget.feature`
      """
    And gtd lands "gtd(agent): architecture.decompose.decomposing → packages.item.building"
    And a file "lib/widget.test.ts" with:
      """
      export const widgetTest = 1
      """
    And a file "spec/widget.feature" with:
      """
      Feature: Widget
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building → packages.item.health.check"

  Scenario: a builder editing its own Tests section cannot dodge the guard
    Given a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget.

      ## Tests

      - unit: `lib/widget.test.ts`
      """
    And gtd lands "gtd(agent): architecture.decompose.decomposing → packages.item.building"
    And ".gtd/packages/01-widget.md" is modified to:
      """
      Package: the widget.
      """
    When I run gtd land
    Then it fails
    And stderr contains "lib/widget.test.ts"

  Scenario: with SATISFIED.md written, a declared test already in the tree suffices
    Given a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget.

      ## Tests

      - unit: `lib/existing.test.ts`
      """
    And gtd lands "gtd(agent): architecture.decompose.decomposing → packages.item.building"
    And a file ".gtd/SATISFIED.md" with:
      """
      - [x] lib/existing.test.ts — already present
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building → packages.item.health.check"
