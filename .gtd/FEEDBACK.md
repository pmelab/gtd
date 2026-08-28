> @pmelab/gtd@10.2.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, deadcode • Remote caching disabled, using shared worktree cache

deadcode: cache miss, executing fa1c8779aa5acc55 format:check: cache miss,
executing dd17eed8560cc26f test:e2e:inmem: cache miss, executing
f04e26b60a2f45cf build: cache miss, executing 18bc29cfaaaa759d lint:sh: cache
miss, executing a1ef358e259df893 test:unit: cache miss, executing
aa950ea4aa6d935d lint: cache miss, executing 835d07317f261c2e typecheck: cache
miss, executing f99352a4f093399d build: test:e2e:inmem: test:e2e:inmem: >
@pmelab/gtd@10.2.0 test:e2e:inmem test:e2e:inmem: > vitest run --project
e2e-inmem test:e2e:inmem: deadcode: deadcode: > @pmelab/gtd@10.2.0 deadcode
deadcode: > fallow --summary --quiet deadcode: format:check: format:check: >
@pmelab/gtd@10.2.0 format:check format:check: > oxfmt --check . format:check:
build: > @pmelab/gtd@10.2.0 build build: > tsdown build: lint: lint: >
@pmelab/gtd@10.2.0 lint lint: > oxlint . lint: typecheck: typecheck: >
@pmelab/gtd@10.2.0 typecheck typecheck: > tsc --noEmit typecheck: test:unit:
test:unit: > @pmelab/gtd@10.2.0 test:unit test:unit: > vitest run --project unit
test:unit: lint:sh: lint:sh: > @pmelab/gtd@10.2.0 lint:sh lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: format:check: Checking formatting...
format:check: build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m lint: Found 0 warnings and 0 errors. lint:
Finished in 299ms on 109 files with 96 rules using 10 threads. deadcode: Health
Summary deadcode: deadcode: 3575 Functions analyzed deadcode: 0 Above threshold
deadcode: 91.3 Average maintainability (good) build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/mutation-test-gaps/tsdown.config.ts[24m
build: [34mℹ[39m entry: [34msrc/main.ts[39m build: [34mℹ[39m target:
[34mnode20[39m build: [34mℹ[39m tsconfig: [34mtsconfig.json[39m build: [34mℹ[39m
Build start build: [34mℹ[39m Cleaning 1 files format:check: All matched files
use the correct format. format:check: Finished in 1110ms on 140 files using 10
threads. lint:sh: tests/shell/corpus/ is up to date (37 files) build: [34mℹ[39m
Hint: consider adding [34mdeps.onlyBundle[39m option to avoid unintended
bundling of dependencies, or set [34mdeps.onlyBundle: false[39m to disable this
hint. build: See more at
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
total: 10.06 MB build: [32m✔[39m Build complete in [32m2125ms[39m build:
build: > @pmelab/gtd@10.2.0 postbuild build: > jiti scripts/generate-schema.ts
&& node scripts/assert-no-test-doubles.mjs build: test:e2e:live: cache miss,
executing c512889639a95e05 test:e2e:live: test:e2e:live: > @pmelab/gtd@10.2.0
test:e2e:live test:e2e:live: > vitest run --project e2e-live
--no-file-parallelism test:e2e:live: test:e2e:live: test:e2e:live: FAIL Feature:
Honoring $TMPDIR and $GIT_DIR — gtd assumes nothing about /tmp or <cwd>/.git >
Scenario: a full beat lands correctly with the git dir relocated outside the
worktree and TMPDIR pointed elsewhere (@live) test:e2e:live: nothing was written
under the overridden TMPDIR (#28) test:e2e:live: Expected the overridden TMPDIR
("/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tmpdir-gitdir-scenario-cS0aFV/custom-tmp")
to remain empty. Got: xcrun_db test:e2e:live: + actual - expected test:e2e:live:
test:e2e:live: + [ test:e2e:live: + 'xcrun_db' test:e2e:live: + ]
test:e2e:live: - [] test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/mutation-test-gaps/tests/integration/features/tmpdir-and-git-dir.feature:28:1
test:e2e:live: test:e2e:live: FAIL Feature: Honoring $TMPDIR and $GIT_DIR — gtd
assumes nothing about /tmp or <cwd>/.git > Scenario: the emitted validate script
may write under TMPDIR while gtd itself still writes nothing there (@live)
test:e2e:live: Scenario finished with 1 errors: test:e2e:live: test:e2e:live:
nothing was written under the overridden TMPDIR (#72) test:e2e:live: Expected
the overridden TMPDIR
("/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tmpdir-gitdir-scenario-AnfWNl/custom-tmp")
to remain empty. Got: xcrun_db test:e2e:live: + actual - expected test:e2e:live:
test:e2e:live: + [ test:e2e:live: + 'xcrun_db' test:e2e:live: + ]
test:e2e:live: - [] test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/mutation-test-gaps/tests/integration/features/tmpdir-and-git-dir.feature:72:1
test:e2e:live: test:e2e:live: 2 test(s) failed test:e2e:live: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/mutation-test-gaps/)
/Users/pmelab/.herdr/worktrees/gtd/mutation-test-gaps/node_modules/.bin/npm run
test:e2e:live exited (1)

Tasks: 8 successful, 9 total Cached: 0 cached, 9 total Time: 6m40.371s Failed:
//#test:e2e:live

ERROR run failed: command exited (1)

<!-- gtd check 01c17a87 -->
