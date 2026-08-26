> @pmelab/gtd@9.13.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, deadcode • Remote caching disabled, using shared worktree cache

format:check: cache miss, executing 3da9ab4729fe5ac2 test:e2e:inmem: cache miss,
executing b3c7c2379c3caa76 lint: cache miss, executing 113da5bb09e50395 lint:sh:
cache miss, executing f11bc19d48e195c5 deadcode: cache miss, executing
39fbf5d8a83615ba build: cache miss, executing 73a9f49a5d1069c0 test:unit: cache
miss, executing cc6e9c7ba068994f typecheck: cache miss, executing
e6598336e7e4effb test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@9.13.0
test:e2e:inmem test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem:
lint:sh: lint:sh: > @pmelab/gtd@9.13.0 lint:sh lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: format:check: format:check: >
@pmelab/gtd@9.13.0 format:check format:check: > oxfmt --check . format:check:
typecheck: typecheck: > @pmelab/gtd@9.13.0 typecheck typecheck: > tsc --noEmit
typecheck: lint: lint: > @pmelab/gtd@9.13.0 lint lint: > oxlint . lint:
deadcode: deadcode: > @pmelab/gtd@9.13.0 deadcode deadcode: > fallow --summary
--quiet deadcode: test:unit: test:unit: > @pmelab/gtd@9.13.0 test:unit
test:unit: > vitest run --project unit test:unit: build: build: >
@pmelab/gtd@9.13.0 build build: > tsdown build: format:check: Checking
formatting... format:check: format:check: All matched files use the correct
format. format:check: Finished in 714ms on 135 files using 10 threads. lint:sh:
tests/shell/corpus/ is up to date (39 files) lint: Found 0 warnings and 0
errors. lint: Finished in 11ms on 107 files with 96 rules using 10 threads.
build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown
v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/simplify-land/tsdown.config.ts[24m build:
[34mℹ[39m entry: [34msrc/main.ts[39m build: [34mℹ[39m target: [34mnode20[39m
build: [34mℹ[39m tsconfig: [34mtsconfig.json[39m build: [34mℹ[39m Build start
build: [34mℹ[39m Hint: consider adding [34mdeps.onlyBundle[39m option to avoid
unintended bundling of dependencies, or set [34mdeps.onlyBundle: false[39m to
disable this hint. build: See more at
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
total: 10.06 MB build: [32m✔[39m Build complete in [32m1552ms[39m build:
build: > @pmelab/gtd@9.13.0 postbuild build: > jiti scripts/generate-schema.ts
&& node scripts/assert-no-test-doubles.mjs build: test:e2e:live: cache miss,
executing cefe68131c9aad61 test:e2e:live: test:e2e:live: > @pmelab/gtd@9.13.0
test:e2e:live test:e2e:live: > vitest run --project e2e-live test:e2e:live:
deadcode: Health Summary deadcode: deadcode: 3438 Functions analyzed deadcode: 0
Above threshold deadcode: 91.3 Average maintainability (good) test:e2e:live:
test:e2e:live: FAIL Feature: A signal death reports the promised exit status and
leaves nothing half-written > Scenario: SIGTERM kills a spawned gtd next with
status 143 (@live) test:e2e:live: I send SIGTERM to a spawned gtd next (#40)
test:e2e:live: Step timed out after 30000ms test:e2e:live: Error: I send SIGTERM
to a spawned gtd next (#40) test:e2e:live: test:e2e:live: 1 test(s) failed
test:e2e:live: ERROR command (/Users/pmelab/.herdr/worktrees/gtd/simplify-land/)
/Users/pmelab/.herdr/worktrees/gtd/simplify-land/node_modules/.bin/npm run
test:e2e:live exited (1)

Tasks: 8 successful, 9 total Cached: 0 cached, 9 total Time: 1m30.967s Failed:
//#test:e2e:live

ERROR run failed: command exited (1)

<!-- gtd check 0b76a8cf -->
