> @pmelab/gtd@10.5.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live test:web deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, test:web, deadcode • Remote caching disabled, using shared
worktree cache

build: cache miss, executing c40418c23caaa0fe test:web: cache miss, executing
2b5eaff2bece8a21 deadcode: cache miss, executing c230e79699a41e36 typecheck:
cache miss, executing f87dedc39eeb69e0 format:check: cache miss, executing
ea1b60f5274a9ce1 lint: cache miss, executing 21a580da5bf240dc lint:sh: cache
miss, executing fedb05221ca11462 test:web: test:web: > @pmelab/gtd@10.5.0
test:web test:web: > vitest run --project storybook test:web: lint:sh:
lint:sh: > @pmelab/gtd@10.5.0 lint:sh lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: build: build: > @pmelab/gtd@10.5.0 build
build: > tsdown --filter web && node scripts/inline-web-client.mjs && tsdown
--filter gtd build: typecheck: typecheck: > @pmelab/gtd@10.5.0 typecheck
typecheck: > tsc --noEmit && tsc --noEmit -p src/web/tsconfig.json typecheck:
lint: lint: > @pmelab/gtd@10.5.0 lint lint: > oxlint . lint: format:check:
format:check: > @pmelab/gtd@10.5.0 format:check format:check: > oxfmt --check .
format:check: deadcode: deadcode: > @pmelab/gtd@10.5.0 deadcode deadcode: >
fallow --summary --quiet deadcode: format:check: Checking formatting...
format:check: lint: Found 0 warnings and 0 errors. lint: Finished in 18ms on 200
files with 116 rules using 10 threads. build: [34mℹ[39m [34mtsdown v0.22.8[39m
powered by [38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m tsconfig:
[38;2;100;116;180mtsconfig.json[39m build: [34mℹ[39m Build start lint:sh:
tests/shell/corpus/ is up to date (37 files) build: [34mℹ[39m
[38;2;100;116;180m[web][39m Hint: consider adding [34mdeps.onlyBundle[39m option
to avoid unintended bundling of dependencies, or set [34mdeps.onlyBundle:
false[39m to disable this hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34mreact[39m build: -
[34m@tanstack/react-query[39m build: - [34m@tanstack/query-core[39m build: -
[34m@trpc/client[39m build: - [34m@trpc/server[39m build: - [34mscheduler[39m
build: - [34mreact-dom[39m build: - [34m@trpc/react-query[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.08 MB[22m build:
[34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.08 MB build: [32m✔[39m
[38;2;100;116;180m[web][39m Build complete in [32m143ms[39m build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m deadcode:
Dead Code Summary deadcode: deadcode: 5 Dev dependencies in production deadcode:
deadcode: 5 Total deadcode: Duplication Summary deadcode: deadcode: 2 Clone
families deadcode: 2 Clone groups deadcode: 940 Duplicated lines deadcode: 3.5%
Duplication rate deadcode: Health Summary deadcode: deadcode: 5216 Functions
analyzed deadcode: 8 Above threshold deadcode: 91.5 Average maintainability
(good) build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;155;180;100m[gtd][39m entry:
[38;2;155;180;100msrc/main.ts[39m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
target: [38;2;155;180;100mnode20[39m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m tsconfig: [38;2;155;180;100mtsconfig.json[39m build:
[34mℹ[39m Build start build: [34mℹ[39m Cleaning 3 files format:check: All
matched files use the correct format. format:check: Finished in 528ms on 237
files using 10 threads. deadcode: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/)
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/node_modules/.bin/npm run
deadcode exited (1)

Tasks: 3 successful, 7 total Cached: 0 cached, 7 total Time: 1.056s Failed:
//#deadcode

ERROR run failed: command exited (1)

<!-- gtd check 93b9f911 -->
