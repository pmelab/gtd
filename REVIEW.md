# Review: b7f1bab

<!-- base: b7f1bab93196675fab3dee26fb06b5b78b1b3d68 -->

## Add repo-local gtd config

Adds `.gtdrc` at the repo root to configure the test command for the gtd repo
itself, so the execute/human-review gates run both unit tests and e2e cucumber
tests instead of just `npm run test`.

- [ ] ./.gtdrc#1
