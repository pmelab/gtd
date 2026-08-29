> @pmelab/gtd@10.2.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, deadcode • Remote caching disabled, using shared worktree cache

test:e2e:inmem: cache miss, executing 1d28835c849ce52b build: cache hit,
replaying logs 12f5fdc255767193 lint:sh: cache hit, replaying logs
f93b50ed1b65d50b lint:sh: lint:sh: > @pmelab/gtd@10.2.0 lint:sh build: build: >
@pmelab/gtd@10.2.0 build build: > tsdown build: lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: lint:sh: tests/shell/corpus/ is up to date (37
files) build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/evals/tsdown.config.ts[24m build:
[34mℹ[39m entry: [34msrc/main.ts[39m build: [34mℹ[39m target: [34mnode20[39m
build: [34mℹ[39m tsconfig: [34mtsconfig.json[39m build: [34mℹ[39m Build start
build: [34mℹ[39m Cleaning 1 files build: [34mℹ[39m Hint: consider adding
[34mdeps.onlyBundle[39m option to avoid unintended bundling of dependencies, or
set [34mdeps.onlyBundle: false[39m to disable this hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34meffect[39m build: -
[34m@effect/platform[39m build: - [34m@effect/platform-node-shared[39m build: -
[34m@effect/platform-node[39m build: - [34mresolve-from[39m build: -
[34mcallsites[39m build: - [34mparent-module[39m build: - [34mimport-fresh[39m
build: - [34mis-arrayish[39m build: - [34merror-ex[39m build: -
[34mjson-parse-even-better-errors[39m build: - [34mlines-and-columns[39m
build: - [34mpicocolors[39m build: - [34mjs-tokens[39m build: -
[34m@babel/helper-validator-identifier[39m build: - [34m@babel/code-frame[39m
build: - [34mparse-json[39m build: - [34mjs-yaml[39m build: - [34mtypescript[39m
build: - [34mcosmiconfig[39m build: - [34menv-paths[39m build: - [34myaml[39m
build: - [34meta[39m build: - [34mvscode-languageserver[39m build: -
[34mvscode-jsonrpc[39m build: - [34mvscode-languageserver-types[39m build: -
[34mvscode-languageserver-protocol[39m build: -
[34mvscode-languageserver-textdocument[39m build: [34mℹ[39m Granting execute
permission to [4mdist/gtd.bundle.mjs[24m build: [34mℹ[39m
[2mdist/[22m[1mgtd.bundle.mjs[22m [2m10.06 MB[22m build: [34mℹ[39m 1 files,
total: 10.06 MB build: [32m✔[39m Build complete in [32m599ms[39m build: build: >
@pmelab/gtd@10.2.0 postbuild build: > jiti scripts/generate-schema.ts && node
scripts/assert-no-test-doubles.mjs build: test:e2e:live: cache miss, executing
ece91b7cbaaa944d typecheck: cache miss, executing b98ebca95c55c249 deadcode:
cache miss, executing 58a341f3f5e51faf test:unit: cache miss, executing
58e5769953b652be format:check: cache miss, executing a1d9f1746f2cb75d lint:
cache miss, executing 513d5f629ed85d8f format:check: format:check: >
@pmelab/gtd@10.2.0 format:check format:check: > oxfmt --check . format:check:
test:e2e:live: test:e2e:live: > @pmelab/gtd@10.2.0 test:e2e:live
test:e2e:live: > vitest run --project e2e-live test:e2e:live: typecheck:
typecheck: > @pmelab/gtd@10.2.0 typecheck typecheck: > tsc --noEmit typecheck:
test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@10.2.0 test:e2e:inmem
test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem: test:unit:
test:unit: > @pmelab/gtd@10.2.0 test:unit test:unit: > vitest run --project unit
test:unit: lint: lint: > @pmelab/gtd@10.2.0 lint lint: > oxlint . lint:
deadcode: deadcode: > @pmelab/gtd@10.2.0 deadcode deadcode: > fallow --summary
--quiet deadcode: format:check: Checking formatting... format:check: lint: Found
0 warnings and 0 errors. lint: Finished in 21ms on 134 files with 96 rules using
10 threads. deadcode: Health Summary deadcode: deadcode: 3591 Functions analyzed
deadcode: 0 Above threshold deadcode: 91.6 Average maintainability (good)
format:check: All matched files use the correct format. format:check: Finished
in 481ms on 168 files using 10 threads. test:unit: Finished in 12ms on 1 files
using 10 threads. test:unit: Finished in 48ms on 1 files using 10 threads.
test:unit: Finished in 48ms on 1 files using 10 threads. test:unit: ERROR
command (/Users/pmelab/.herdr/worktrees/gtd/evals/)
/Users/pmelab/.herdr/worktrees/gtd/evals/node_modules/.bin/npm run test:unit
exited (1)

Tasks: 7 successful, 9 total Cached: 2 cached, 9 total Time: 48.84s Failed:
//#test:unit

ERROR run failed: command exited (1)

<!-- gtd check 4f0b40a8 -->
