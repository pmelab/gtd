> @pmelab/gtd@10.5.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, deadcode • Remote caching disabled, using shared worktree cache

lint:sh: cache miss, executing 5d8ef06aacf5eb64 lint: cache miss, executing
3c13abf4b3cf41eb build: cache miss, executing 5f6f9c46b4390e71 format:check:
cache miss, executing 7002f9458af07925 typecheck: cache miss, executing
a83a7bda886c68fe deadcode: cache miss, executing 0dd94c0f03087fcd deadcode:
deadcode: > @pmelab/gtd@10.5.0 deadcode deadcode: > fallow --summary --quiet
deadcode: lint:sh: lint:sh: > @pmelab/gtd@10.5.0 lint:sh lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: build: build: > @pmelab/gtd@10.5.0 build
build: > tsdown --filter web && node scripts/inline-web-client.mjs && tsdown
--filter gtd build: lint: lint: > @pmelab/gtd@10.5.0 lint lint: > oxlint . lint:
typecheck: typecheck: > @pmelab/gtd@10.5.0 typecheck typecheck: > tsc --noEmit
typecheck: format:check: format:check: > @pmelab/gtd@10.5.0 format:check
format:check: > oxfmt --check . format:check: format:check: Checking
formatting... format:check: build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m lint: Found 0 warnings and 0 errors. lint:
Finished in 34ms on 153 files with 96 rules using 10 threads. build: [34mℹ[39m
config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m tsconfig:
[38;2;100;116;180mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m [38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m0.51
kB[22m [2m│ gzip: 0.33 kB[22m build: [34mℹ[39m [38;2;100;116;180m[web][39m 1
files, total: 0.51 kB build: [32m✔[39m [38;2;100;116;180m[web][39m Build
complete in [32m134ms[39m build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;155;180;100m[gtd][39m entry:
[38;2;155;180;100msrc/main.ts[39m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
target: [38;2;155;180;100mnode20[39m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m tsconfig: [38;2;155;180;100mtsconfig.json[39m build:
[34mℹ[39m Build start build: [34mℹ[39m Cleaning 3 files deadcode: Dead Code
Summary deadcode: deadcode: 1 Unused files deadcode: deadcode: 1 Total deadcode:
Health Summary deadcode: deadcode: 4431 Functions analyzed deadcode: 0 Above
threshold deadcode: 91.3 Average maintainability (good) format:check: All
matched files use the correct format. format:check: Finished in 529ms on 192
files using 10 threads. deadcode: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/)
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/node_modules/.bin/npm run
deadcode exited (1)

Tasks: 2 successful, 6 total Cached: 0 cached, 6 total Time: 1.134s Failed:
//#deadcode

ERROR run failed: command exited (1)

<!-- gtd check 506554ec -->
