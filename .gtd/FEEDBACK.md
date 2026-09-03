> @pmelab/gtd@10.4.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, deadcode • Remote caching disabled, using shared worktree cache

lint:sh: cache miss, executing 8dfb3375ad3ffdc9 typecheck: cache miss, executing
85e7c55ba012c79f test:e2e:inmem: cache miss, executing ea1a30b6749aaa18 build:
cache miss, executing 7c1d4ddde5696ae6 format:check: cache miss, executing
94980e193bfe52d6 lint: cache miss, executing d74927ae601c4c9e deadcode: cache
miss, executing ebc16b1eecf38cd4 test:unit: cache miss, executing
06b6ffad543d1526 typecheck: typecheck: > @pmelab/gtd@10.4.0 typecheck
typecheck: > tsc --noEmit typecheck: test:e2e:inmem: test:e2e:inmem: >
@pmelab/gtd@10.4.0 test:e2e:inmem test:e2e:inmem: > vitest run --project
e2e-inmem test:e2e:inmem: format:check: format:check: > @pmelab/gtd@10.4.0
format:check format:check: > oxfmt --check . format:check: test:unit:
test:unit: > @pmelab/gtd@10.4.0 test:unit test:unit: > vitest run --project unit
test:unit: build: build: > @pmelab/gtd@10.4.0 build build: > tsdown build: lint:
lint: > @pmelab/gtd@10.4.0 lint lint: > oxlint . lint: deadcode: deadcode: >
@pmelab/gtd@10.4.0 deadcode deadcode: > fallow --summary --quiet deadcode:
lint:sh: lint:sh: > @pmelab/gtd@10.4.0 lint:sh lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: format:check: Checking formatting...
format:check: lint: Found 0 warnings and 0 errors. lint: Finished in 25ms on 143
files with 96 rules using 10 threads. build: [34mℹ[39m [34mtsdown v0.22.8[39m
powered by [38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/mdast/tsdown.config.ts[24m build:
[34mℹ[39m entry: [34msrc/main.ts[39m build: [34mℹ[39m target: [34mnode20[39m
build: [34mℹ[39m tsconfig: [34mtsconfig.json[39m build: [34mℹ[39m Build start
build: [34mℹ[39m Cleaning 1 files deadcode: Health Summary deadcode: deadcode:
4160 Functions analyzed deadcode: 1 Above threshold deadcode: 91.4 Average
maintainability (good) deadcode: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/mdast/)
/Users/pmelab/.herdr/worktrees/gtd/mdast/node_modules/.bin/npm run deadcode
exited (1)

Tasks: 1 successful, 8 total Cached: 0 cached, 8 total Time: 978ms Failed:
//#deadcode

ERROR run failed: command exited (1)

<!-- gtd check 1eff3fec -->
