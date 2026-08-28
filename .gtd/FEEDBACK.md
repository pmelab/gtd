> @pmelab/gtd@10.2.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, deadcode • Remote caching disabled, using shared worktree cache

format:check: cache miss, executing 2a0e29287e18a780 deadcode: cache miss,
executing cc3945f77cce2e75 test:e2e:inmem: cache miss, executing
80d41fa45869b5c8 test:unit: cache miss, executing f481b34af781472f typecheck:
cache miss, executing e900840ccd29c0a4 lint: cache miss, executing
868321ba3949e09d lint:sh: cache miss, executing 39e5c5c73461775a build: cache
miss, executing 03e9121758e2bf83 test:unit: test:unit: > @pmelab/gtd@10.2.0
test:unit test:unit: > vitest run --project unit test:unit: typecheck:
typecheck: > @pmelab/gtd@10.2.0 typecheck typecheck: > tsc --noEmit typecheck:
deadcode: deadcode: > @pmelab/gtd@10.2.0 deadcode deadcode: > fallow --summary
--quiet deadcode: test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@10.2.0
test:e2e:inmem test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem:
build: build: > @pmelab/gtd@10.2.0 build build: > tsdown build: format:check:
format:check: > @pmelab/gtd@10.2.0 format:check format:check: > oxfmt --check .
format:check: lint:sh: lint:sh: > @pmelab/gtd@10.2.0 lint:sh lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: lint: lint: > @pmelab/gtd@10.2.0 lint lint: >
oxlint . lint: format:check: Checking formatting... format:check: build:
[34mℹ[39m [34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m
lint: Found 0 warnings and 0 errors. lint: Finished in 72ms on 111 files with 96
rules using 10 threads. build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/evals/tsdown.config.ts[24m build:
[34mℹ[39m entry: [34msrc/main.ts[39m build: [34mℹ[39m target: [34mnode20[39m
build: [34mℹ[39m tsconfig: [34mtsconfig.json[39m build: [34mℹ[39m Build start
build: [34mℹ[39m Cleaning 1 files lint:sh: tests/shell/corpus/ is up to date (37
files) deadcode: Health Summary deadcode: deadcode: 3487 Functions analyzed
deadcode: 0 Above threshold deadcode: 91.4 Average maintainability (good)
format:check: .gtd/packages/01-eval-suite.md (445ms) format:check:
.gtd/packages/02-baseline-gate.md (257ms) format:check: format:check: Format
issues found in above 2 files. Run without `--check` to fix. format:check:
Finished in 706ms on 144 files using 10 threads. format:check: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/evals/)
/Users/pmelab/.herdr/worktrees/gtd/evals/node_modules/.bin/npm run format:check
exited (1)

Tasks: 3 successful, 8 total Cached: 0 cached, 8 total Time: 1.558s Failed:
//#format:check

ERROR run failed: command exited (1)

<!-- gtd check 1788f77e -->
