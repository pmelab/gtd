# Documentation

- [Driving the loop](./driver.md) — running the loop, writing your own driver,
  the minimal reference driver
- [CLI reference](./cli.md) — every command and flag, exit codes, the error
  envelope
- [Configuration](./configuration.md) — `gtd.config.ts` (the workflow and its
  `config` export), settings, migrating from `.gtdrc`
- [Setup](./setup.md) — repository requirements, editor integration
- [Testing a workflow](./testing.md) — the testkit, under any test runner
- [Workflow kit](./workflow-kit.md) — `@pmelab/gtd/workflow-kit`'s building
  blocks, one example each
- [Development](./development.md) — building and testing gtd itself
- [Compatibility](../COMPATIBILITY.md) — which surfaces are stable, which follow
  package SemVer, which carry no promise
- [Commit messages](./commits.md) — the squash-commit convention
  semantic-release and the PR check read

The `default` workflow (feature → review → fix, plus release-flag rollout and
cleanup) lives in [gtd-workflows](https://github.com/pmelab/gtd-workflows), with
its own guide, reference and delivery model.
