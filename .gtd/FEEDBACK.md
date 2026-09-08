> @pmelab/gtd@10.5.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live test:web deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, test:web, deadcode • Remote caching disabled, using shared
worktree cache

format:check: cache miss, executing 2a653aeadb0d765c deadcode: cache miss,
executing 31fe9d08058d90b9 test:web: cache miss, executing 61c844a6068fa1fc
build: cache miss, executing b8bec6d178094695 typecheck: cache miss, executing
b4029c43cef487d0 lint:sh: cache miss, executing 55d880170bb12685 lint: cache
hit, replaying logs 353e524189d7acfe lint: lint: > @pmelab/gtd@10.5.0 lint
lint: > oxlint . lint: lint: Found 0 warnings and 0 errors. lint: Finished in
73ms on 199 files with 116 rules using 10 threads. build: build: >
@pmelab/gtd@10.5.0 build build: > tsdown --filter web && node
scripts/inline-web-client.mjs && tsdown --filter gtd build: lint:sh: lint:sh: >
@pmelab/gtd@10.5.0 lint:sh lint:sh: > jiti scripts/generate-shell-corpus.ts
--check && shellcheck -s sh tests/shell/corpus/*.sh lint:sh: deadcode:
deadcode: > @pmelab/gtd@10.5.0 deadcode deadcode: > fallow --summary --quiet
deadcode: typecheck: typecheck: > @pmelab/gtd@10.5.0 typecheck typecheck: > tsc
--noEmit && tsc --noEmit -p src/web/tsconfig.json typecheck: format:check:
format:check: > @pmelab/gtd@10.5.0 format:check format:check: > oxfmt --check .
format:check: test:web: test:web: > @pmelab/gtd@10.5.0 test:web test:web: >
vitest run --project storybook test:web: build: [34mℹ[39m [34mtsdown v0.22.8[39m
powered by [38;2;255;126;23mrolldown v1.1.5[39m format:check: Checking
formatting... format:check: build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m tsconfig:
[38;2;100;116;180mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 1 files build: [34mℹ[39m [38;2;100;116;180m[web][39m Hint:
consider adding [34mdeps.onlyBundle[39m option to avoid unintended bundling of
dependencies, or set [34mdeps.onlyBundle: false[39m to disable this hint. build:
See more at [4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m
build: Detected dependencies in bundle: build: - [34mreact[39m build: -
[34m@tanstack/react-query[39m build: - [34m@tanstack/query-core[39m build: -
[34m@trpc/client[39m build: - [34m@trpc/server[39m build: - [34mscheduler[39m
build: - [34mreact-dom[39m build: - [34m@trpc/react-query[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.13 MB[22m build:
[34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.13 MB build: [32m✔[39m
[38;2;100;116;180m[web][39m Build complete in [32m380ms[39m deadcode: Health
Summary deadcode: deadcode: 5390 Functions analyzed deadcode: 1 Above threshold
deadcode: 91.5 Average maintainability (good) lint:sh: tests/shell/corpus/ is up
to date (37 files) build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m test:web: failed to load config from
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/vitest.config.ts test:web:
test:web: ⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯ test:web: Error: The service was
stopped test:web: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/node_modules/esbuild/lib/main.js:949:34
test:web: at responseCallbacks.<computed>
(/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/node_modules/esbuild/lib/main.js:603:9)
test:web: at Socket.afterClose
(/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/node_modules/esbuild/lib/main.js:594:28)
test:web: at Socket.emit (node:events:526:24) test:web: at endReadableNT
(node:internal/streams/readable:1757:12) test:web: at
process.processTicksAndRejections (node:internal/process/task_queues:90:21)
test:web: test:web: test:web: deadcode: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/)
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/node_modules/.bin/npm run
deadcode exited (1)

Tasks: 1 successful, 7 total Cached: 1 cached, 7 total Time: 1.232s Failed:
//#deadcode

ERROR run failed: command exited (1)

<!-- gtd check 9f58a52e -->
