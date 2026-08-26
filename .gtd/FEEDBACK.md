> @pmelab/gtd@9.13.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, deadcode • Remote caching disabled, using shared worktree cache

typecheck: cache miss, executing db8ee1254a313d08 format:check: cache miss,
executing 903d2f93421f9078 deadcode: cache miss, executing f909861facfda51f
test:unit: cache miss, executing 6ff17039e093f6ef lint: cache miss, executing
ac7fbce2a2b472dc test:e2e:inmem: cache miss, executing 6a519f9dfb4b58b4 lint:sh:
cache miss, executing 9d9cf165afed0a47 build: cache miss, executing
ceb064cf449df744 lint: lint: > @pmelab/gtd@9.13.0 lint lint: > oxlint . lint:
test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@9.13.0 test:e2e:inmem
test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem: typecheck:
typecheck: > @pmelab/gtd@9.13.0 typecheck typecheck: > tsc --noEmit typecheck:
test:unit: test:unit: > @pmelab/gtd@9.13.0 test:unit test:unit: > vitest run
--project unit test:unit: lint:sh: lint:sh: > @pmelab/gtd@9.13.0 lint:sh
lint:sh: > jiti scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: format:check: format:check: >
@pmelab/gtd@9.13.0 format:check format:check: > oxfmt --check . format:check:
build: build: > @pmelab/gtd@9.13.0 build build: > tsdown build: deadcode:
deadcode: > @pmelab/gtd@9.13.0 deadcode deadcode: > fallow --summary --quiet
deadcode: lint: Found 0 warnings and 0 errors. lint: Finished in 34ms on 109
files with 96 rules using 10 threads. format:check: Checking formatting...
format:check: build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/simplify-land/tsdown.config.ts[24m build:
[34mℹ[39m entry: [34msrc/main.ts[39m build: [34mℹ[39m target: [34mnode20[39m
build: [34mℹ[39m tsconfig: [34mtsconfig.json[39m build: [34mℹ[39m Build start
build: [34mℹ[39m Cleaning 1 files deadcode: Health Summary deadcode: deadcode:
3508 Functions analyzed deadcode: 1 Above threshold deadcode: 91.4 Average
maintainability (good) lint:sh: tests/shell/corpus/ is up to date (39 files)
deadcode: ERROR command (/Users/pmelab/.herdr/worktrees/gtd/simplify-land/)
/Users/pmelab/.herdr/worktrees/gtd/simplify-land/node_modules/.bin/npm run
deadcode exited (1)

Tasks: 1 successful, 8 total Cached: 0 cached, 8 total Time: 1.202s Failed:
//#deadcode

ERROR run failed: command exited (1)

<!-- gtd check 71d438e0 -->
