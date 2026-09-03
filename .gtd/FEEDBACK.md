> @pmelab/gtd@10.4.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, deadcode • Remote caching disabled, using shared worktree cache

test:e2e:inmem: cache miss, executing 2ab90b7418e2d4d6 test:unit: cache miss,
executing ef111d7b30b926ee format:check: cache miss, executing cf9e290cdd81f14c
build: cache miss, executing da2af588793c0707 lint:sh: cache miss, executing
ebeee93042b31a58 deadcode: cache miss, executing 4d1c26dfb17fd35e lint: cache
miss, executing 67a9d5ae2d79641a typecheck: cache miss, executing
bd1167cff70f0482 format:check: format:check: > @pmelab/gtd@10.4.0 format:check
format:check: > oxfmt --check . format:check: lint: lint: > @pmelab/gtd@10.4.0
lint lint: > oxlint . lint: lint:sh: lint:sh: > @pmelab/gtd@10.4.0 lint:sh
lint:sh: > jiti scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: test:e2e:inmem: test:e2e:inmem: >
@pmelab/gtd@10.4.0 test:e2e:inmem test:e2e:inmem: > vitest run --project
e2e-inmem test:e2e:inmem: deadcode: deadcode: > @pmelab/gtd@10.4.0 deadcode
deadcode: > fallow --summary --quiet deadcode: typecheck: typecheck: >
@pmelab/gtd@10.4.0 typecheck typecheck: > tsc --noEmit typecheck: test:unit:
test:unit: > @pmelab/gtd@10.4.0 test:unit test:unit: > vitest run --project unit
test:unit: build: build: > @pmelab/gtd@10.4.0 build build: > tsdown build:
format:check: Checking formatting... format:check: lint: Found 0 warnings and 0
errors. lint: Finished in 50ms on 143 files with 96 rules using 10 threads.
build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown
v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/mdast/tsdown.config.ts[24m build:
[34mℹ[39m entry: [34msrc/main.ts[39m build: [34mℹ[39m target: [34mnode20[39m
build: [34mℹ[39m tsconfig: [34mtsconfig.json[39m build: [34mℹ[39m Build start
build: [34mℹ[39m Cleaning 1 files deadcode: Health Summary deadcode: deadcode:
4120 Functions analyzed deadcode: 1 Above threshold deadcode: 91.4 Average
maintainability (good) test:e2e:inmem: failed to load config from
/Users/pmelab/.herdr/worktrees/gtd/mdast/vitest.config.ts test:e2e:inmem:
test:e2e:inmem: ⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯ test:e2e:inmem: Error: The
service was stopped: write EPIPE test:e2e:inmem: at
/Users/pmelab/.herdr/worktrees/gtd/mdast/node_modules/esbuild/lib/main.js:949:34
test:e2e:inmem: at responseCallbacks.<computed>
(/Users/pmelab/.herdr/worktrees/gtd/mdast/node_modules/esbuild/lib/main.js:603:9)
test:e2e:inmem: at afterClose
(/Users/pmelab/.herdr/worktrees/gtd/mdast/node_modules/esbuild/lib/main.js:594:28)
test:e2e:inmem: at
/Users/pmelab/.herdr/worktrees/gtd/mdast/node_modules/esbuild/lib/main.js:1986:18
test:e2e:inmem: at onwriteError (node:internal/streams/writable:603:3)
test:e2e:inmem: at process.processTicksAndRejections
(node:internal/process/task_queues:92:21) test:e2e:inmem: test:e2e:inmem:
test:e2e:inmem: deadcode: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/mdast/)
/Users/pmelab/.herdr/worktrees/gtd/mdast/node_modules/.bin/npm run deadcode
exited (1)

Tasks: 1 successful, 8 total Cached: 0 cached, 8 total Time: 1.236s Failed:
//#deadcode

ERROR run failed: command exited (1)

<!-- gtd check ca1e94c0 -->
