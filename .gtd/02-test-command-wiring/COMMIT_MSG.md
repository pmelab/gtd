feat(config): drive the test gate from configurable testCommand

TestRunner.Live now depends on ConfigService and runs the resolved testCommand
(tokenized to argv) instead of the hardcoded `npm run test`; the default is
preserved when no config file is present. main.ts provides ConfigService.Live
in the layer stack so the dependency is satisfied at the composition root.
TestRunner tests cover both the default path and a custom testCommand supplied
via a .gtdrc in the project dir.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
