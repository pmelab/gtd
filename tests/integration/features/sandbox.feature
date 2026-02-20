@sandbox
Feature: Sandbox boundaries

  Scenario: Network - untrusted domain denied by default
    When I check sandbox "network" for "evil-api.example.com" as "claude"
    Then it is a sandbox violation
    And output contains "evil-api.example.com"
    And output contains "allowedDomains"

  Scenario: Network - config escalation allows denied domain
    When I check sandbox "network" for "registry.npmjs.org" as "pi"
    Then it is a sandbox violation
    When sandbox config adds network allowedDomains "registry.npmjs.org"
    And I check sandbox "network" for "registry.npmjs.org" as "pi"
    Then it succeeds
    And output contains "Access allowed"

  Scenario: Network - agent-essential domain always allowed
    When I check sandbox "network" for "api.anthropic.com" as "claude"
    Then it succeeds

  Scenario: FS write - outside cwd denied by default
    When I check sandbox "write" for outside path
    Then it is a sandbox violation
    And output contains "allowWrite"

  Scenario: FS write - config escalation allows denied path
    When I check sandbox "write" for outside path
    Then it is a sandbox violation
    When sandbox config adds filesystem allowWrite for outside path
    And I check sandbox "write" for outside path
    Then it succeeds
    And output contains "Access allowed"

  Scenario: FS write - within cwd allowed by default
    When I check sandbox "write" for inside path "src/file.ts"
    Then it succeeds

  Scenario: FS read - outside cwd denied by default
    When I check sandbox "read" for outside path
    Then it is a sandbox violation
    And output contains "allowRead"

  Scenario: FS read - config escalation allows denied path
    When I check sandbox "read" for outside path
    Then it is a sandbox violation
    When sandbox config adds filesystem allowRead for outside path
    And I check sandbox "read" for outside path
    Then it succeeds
    And output contains "Access allowed"

  Scenario: FS read - within cwd allowed by default
    When I check sandbox "read" for inside path "src/file.ts"
    Then it succeeds
