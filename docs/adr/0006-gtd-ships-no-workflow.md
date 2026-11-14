# gtd ships no workflow

gtd is an engine, not a method. Every workflow is the consumer's own code in
their `gtd.config.ts`. gtd once bundled a default workflow and later kept one in
a separate repository; both were removed, because a shipped workflow's step
names and conventions became gtd's public API and pulled the engine toward one
way of working.

## Consequences

- gtd assumes no forge, review model, branching convention or ticket system.
  Pushing a branch, opening a pull request or updating a ticket is a `run()`
  step that a workflow writes, so gtd fits any team's process without the team
  adopting gtd.
