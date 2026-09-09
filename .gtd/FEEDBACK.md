> @pmelab/gtd@10.5.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live test:web deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, test:web, deadcode • Remote caching disabled, using shared
worktree cache

lint:sh: cache miss, executing ce27381d698bb401 format:check: cache miss,
executing cb4f6c26d61aba22 typecheck: cache miss, executing 8f3a3aaa39cdd317
lint: cache miss, executing 7524aaf12b399a1c test:web: cache miss, executing
c06c64d845c19771 deadcode: cache miss, executing 22f8beba4a1b9299 build: cache
miss, executing accf4ab16fda356d lint:sh: lint:sh: > @pmelab/gtd@10.5.0 lint:sh
lint:sh: > jiti scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: lint: lint: > @pmelab/gtd@10.5.0 lint lint: >
oxlint . lint: build: build: > @pmelab/gtd@10.5.0 build build: > tsdown --filter
web && node scripts/inline-web-client.mjs && tsdown --filter gtd build:
typecheck: typecheck: > @pmelab/gtd@10.5.0 typecheck typecheck: > tsc --noEmit
&& tsc --noEmit -p src/web/tsconfig.json typecheck: deadcode: deadcode: >
@pmelab/gtd@10.5.0 deadcode deadcode: > fallow --summary --quiet deadcode:
format:check: format:check: > @pmelab/gtd@10.5.0 format:check format:check: >
oxfmt --check . format:check: test:web: test:web: > @pmelab/gtd@10.5.0 test:web
test:web: > vitest run --project storybook test:web: format:check: Checking
formatting... format:check: build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m lint: lint: ! react-hooks(exhaustive-deps):
React Hook useEffect has a missing dependency: 'runCommitFreeText' lint:
,-[src/web/screens/Question.tsx:403:6] lint: 399 | clearDebounceTimer() lint:
400 | runCommitFreeText() lint: : ^^^^^^^^|^^^^^^^^ lint: :
`-- useEffect uses `runCommitFreeText`here lint:  401 |       } lint:  402 |     } lint:  403 |   }, []) lint:      :      ^^ lint:  404 |  lint:     `----
lint: help: Either include it or remove the dependency array. lint: lint: Found
1 warning and 0 errors. lint: Finished in 83ms on 206 files with 116 rules using
10 threads. build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m tsconfig:
[38;2;100;116;180mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m [38;2;100;116;180m[web][39m Hint: consider adding
[34mdeps.onlyBundle[39m option to avoid unintended bundling of dependencies, or
set [34mdeps.onlyBundle: false[39m to disable this hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34mreact[39m build: -
[34m@tanstack/react-query[39m build: - [34m@tanstack/query-core[39m build: -
[34m@trpc/client[39m build: - [34m@trpc/server[39m build: - [34mscheduler[39m
build: - [34mreact-dom[39m build: - [34m@trpc/react-query[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.14 MB[22m build:
[34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.14 MB build: [32m✔[39m
[38;2;100;116;180m[web][39m Build complete in [32m322ms[39m lint:sh:
tests/shell/corpus/ is up to date (37 files) deadcode: Dead Code Summary
deadcode: deadcode: 1 Unused files deadcode: deadcode: 1 Total deadcode: Health
Summary deadcode: deadcode: 5657 Functions analyzed deadcode: 3 Above threshold
deadcode: 91.4 Average maintainability (good) build: [34mℹ[39m [34mtsdown
v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m format:check: All
matched files use the correct format. format:check: Finished in 911ms on 245
files using 10 threads. build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;155;180;100m[gtd][39m entry:
[38;2;155;180;100msrc/main.ts[39m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
target: [38;2;155;180;100mnode20[39m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m tsconfig: [38;2;155;180;100mtsconfig.json[39m build:
[34mℹ[39m Build start build: [34mℹ[39m Cleaning 3 files deadcode: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/)
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/node_modules/.bin/npm run
deadcode exited (1)

Tasks: 2 successful, 7 total Cached: 0 cached, 7 total Time: 1.689s Failed:
//#deadcode

ERROR run failed: command exited (1)

<!-- gtd check 6bb0f230 -->
