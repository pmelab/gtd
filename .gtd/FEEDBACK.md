> @pmelab/gtd@10.4.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, deadcode • Remote caching disabled, using shared worktree cache

typecheck: cache miss, executing b3e4d14f8ceeb695 lint:sh: cache miss, executing
229584fec79f04f4 deadcode: cache miss, executing abcb8925ce6c24cb format:check:
cache miss, executing 57e3c2d0454b0bef build: cache miss, executing
8f9f55e2e9ab0c93 test:e2e:inmem: cache miss, executing 8d6f5373d44389dc
test:unit: cache miss, executing 6b60cd454eed41c5 lint: cache miss, executing
b31cca912b0b483a deadcode: deadcode: > @pmelab/gtd@10.4.0 deadcode deadcode: >
fallow --summary --quiet deadcode: lint: lint: > @pmelab/gtd@10.4.0 lint lint: >
oxlint . lint: lint:sh: lint:sh: > @pmelab/gtd@10.4.0 lint:sh lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: format:check: format:check: >
@pmelab/gtd@10.4.0 format:check format:check: > oxfmt --check . format:check:
test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@10.4.0 test:e2e:inmem
test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem: build: build: >
@pmelab/gtd@10.4.0 build build: > tsdown build: typecheck: typecheck: >
@pmelab/gtd@10.4.0 typecheck typecheck: > tsc --noEmit typecheck: test:unit:
test:unit: > @pmelab/gtd@10.4.0 test:unit test:unit: > vitest run --project unit
test:unit: lint: Found 0 warnings and 0 errors. lint: Finished in 10ms on 141
files with 96 rules using 10 threads. format:check: Checking formatting...
format:check: build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/footnotes/tsdown.config.ts[24m build:
[34mℹ[39m entry: [34msrc/main.ts[39m build: [34mℹ[39m target: [34mnode20[39m
build: [34mℹ[39m tsconfig: [34mtsconfig.json[39m build: [34mℹ[39m Build start
build: [34mℹ[39m Cleaning 1 files deadcode: Health Summary deadcode: deadcode:
3921 Functions analyzed deadcode: 1 Above threshold deadcode: 91.4 Average
maintainability (good) deadcode: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/footnotes/)
/Users/pmelab/.herdr/worktrees/gtd/footnotes/node_modules/.bin/npm run deadcode
exited (1)

Tasks: 1 successful, 8 total Cached: 0 cached, 8 total Time: 995ms Failed:
//#deadcode

ERROR run failed: command exited (1)

<!-- gtd check b643eeab -->
