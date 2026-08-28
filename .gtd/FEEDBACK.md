> @pmelab/gtd@10.2.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, deadcode • Remote caching disabled, using shared worktree cache

test:unit: cache miss, executing 0bfc41867a174478 format:check: cache miss,
executing eb7dc90142262133 deadcode: cache miss, executing 842cae137b464817
build: cache miss, executing 6c2f610c26c9666f test:e2e:inmem: cache miss,
executing 7c204560d950958c lint: cache miss, executing 8b49b67312a917d3
typecheck: cache miss, executing 95dd82d29634f5ab lint:sh: cache miss, executing
68674ff353c675de lint:sh: lint:sh: > @pmelab/gtd@10.2.0 lint:sh lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: test:e2e:inmem: test:e2e:inmem: >
@pmelab/gtd@10.2.0 test:e2e:inmem test:e2e:inmem: > vitest run --project
e2e-inmem test:e2e:inmem: format:check: format:check: > @pmelab/gtd@10.2.0
format:check format:check: > oxfmt --check . format:check: lint: lint: >
@pmelab/gtd@10.2.0 lint lint: > oxlint . lint: build: build: >
@pmelab/gtd@10.2.0 build build: > tsdown build: typecheck: typecheck: >
@pmelab/gtd@10.2.0 typecheck typecheck: > tsc --noEmit typecheck: test:unit:
test:unit: > @pmelab/gtd@10.2.0 test:unit test:unit: > vitest run --project unit
test:unit: deadcode: deadcode: > @pmelab/gtd@10.2.0 deadcode deadcode: > fallow
--summary --quiet deadcode: format:check: Checking formatting... format:check:
deadcode: Health Summary deadcode: deadcode: 3461 Functions analyzed deadcode: 0
Above threshold deadcode: 91.3 Average maintainability (good) lint: Found 0
warnings and 0 errors. lint: Finished in 34ms on 109 files with 96 rules using
10 threads. format:check: All matched files use the correct format.
format:check: Finished in 955ms on 142 files using 10 threads. build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/mutation-test-gaps/tsdown.config.ts[24m
build: [34mℹ[39m entry: [34msrc/main.ts[39m build: [34mℹ[39m target:
[34mnode20[39m build: [34mℹ[39m tsconfig: [34mtsconfig.json[39m build: [34mℹ[39m
Build start build: [34mℹ[39m Cleaning 1 files lint:sh: tests/shell/corpus/ is up
to date (37 files) build: [34mℹ[39m Hint: consider adding
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
total: 10.06 MB build: [32m✔[39m Build complete in [32m4805ms[39m build:
build: > @pmelab/gtd@10.2.0 postbuild build: > jiti scripts/generate-schema.ts
&& node scripts/assert-no-test-doubles.mjs build: test:e2e:live: cache miss,
executing 13997b7494d1982a test:e2e:live: test:e2e:live: > @pmelab/gtd@10.2.0
test:e2e:live test:e2e:live: > vitest run --project e2e-live test:e2e:live:
typecheck: vitest.config.ts(3,23): error TS2307: Cannot find module
'./tests/vitest.rawMd' or its corresponding type declarations. typecheck:
vitest.config.ts(25,11): error TS2769: No overload matches this call. typecheck:
The last overload gave the following error. typecheck: Object literal may only
specify known properties, and 'fileParallelism' does not exist in type
'ProjectConfig'. typecheck: Object literal may only specify known properties,
and 'fileParallelism' does not exist in type 'ProjectConfig'. typecheck:
vitest.config.ts(46,11): error TS2769: No overload matches this call. typecheck:
The last overload gave the following error. typecheck: Object literal may only
specify known properties, and 'fileParallelism' does not exist in type
'ProjectConfig'. typecheck: Object literal may only specify known properties,
and 'fileParallelism' does not exist in type 'ProjectConfig'. typecheck:
vitest.stryker.config.ts(3,23): error TS2307: Cannot find module
'./tests/vitest.rawMd' or its corresponding type declarations. typecheck: ERROR
command (/Users/pmelab/.herdr/worktrees/gtd/mutation-test-gaps/)
/Users/pmelab/.herdr/worktrees/gtd/mutation-test-gaps/node_modules/.bin/npm run
typecheck exited (2)

Tasks: 5 successful, 9 total Cached: 0 cached, 9 total Time: 17.701s Failed:
//#typecheck

ERROR run failed: command exited (2)

<!-- gtd check 39b6204d -->
