> @pmelab/gtd@10.5.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live test:web deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, test:web, deadcode • Remote caching disabled, using shared
worktree cache

lint:sh: cache hit, replaying logs a77c45a02f441377 lint: cache hit, replaying
logs 91b3c5e9ea3c12bc build: cache hit, replaying logs 928a5808b5f0285f lint:sh:
lint:sh: > @pmelab/gtd@10.5.0 lint:sh lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: lint:sh: tests/shell/corpus/ is up to date (37
files) typecheck: cache hit, replaying logs a9b8df3283c34341 lint: lint: >
@pmelab/gtd@10.5.0 lint lint: > oxlint . lint: lint: Found 0 warnings and 0
errors. build: build: > @pmelab/gtd@10.5.0 build build: > tsdown --filter web &&
node scripts/inline-web-client.mjs && tsdown --filter gtd test:web: cache hit,
replaying logs 8e01c83f9c080898 lint: Finished in 25ms on 173 files with 116
rules using 10 threads. format:check: cache hit, replaying logs cbce4d840095cd42
build: build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m tsconfig:
[38;2;100;116;180mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m [38;2;100;116;180m[web][39m Hint: consider adding
[34mdeps.onlyBundle[39m option to avoid unintended bundling of dependencies, or
set [34mdeps.onlyBundle: false[39m to disable this hint. deadcode: cache hit,
replaying logs f24d792e63961d78 build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34mreact[39m build: -
[34m@tanstack/react-query[39m typecheck: typecheck: > @pmelab/gtd@10.5.0
typecheck typecheck: > tsc --noEmit && tsc --noEmit -p src/web/tsconfig.json
typecheck: build: - [34m@tanstack/query-core[39m build: - [34m@trpc/client[39m
build: - [34m@trpc/server[39m build: - [34mscheduler[39m build: -
[34mreact-dom[39m build: - [34m@trpc/react-query[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.08 MB[22m
format:check: format:check: > @pmelab/gtd@10.5.0 format:check format:check: >
oxfmt --check . format:check: format:check: Checking formatting... format:check:
format:check: All matched files use the correct format. build: [34mℹ[39m
[38;2;100;116;180m[web][39m 1 files, total: 1.08 MB build: [32m✔[39m
[38;2;100;116;180m[web][39m Build complete in [32m84ms[39m build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;155;180;100m[gtd][39m entry:
[38;2;155;180;100msrc/main.ts[39m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
target: [38;2;155;180;100mnode20[39m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m tsconfig: [38;2;155;180;100mtsconfig.json[39m build:
[34mℹ[39m Build start build: [34mℹ[39m Cleaning 3 files build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m Hint: consider adding [34mdeps.onlyBundle[39m option
to avoid unintended bundling of dependencies, or set [34mdeps.onlyBundle:
false[39m to disable this hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34meffect[39m build: -
[34m@effect/platform[39m test:web: test:web: > @pmelab/gtd@10.5.0 test:web
test:web: > vitest run --project storybook test:web: format:check: Finished in
504ms on 212 files using 10 threads. deadcode: deadcode: > @pmelab/gtd@10.5.0
deadcode deadcode: > fallow --summary --quiet deadcode: deadcode: Dead Code
Summary deadcode: deadcode: 5 Dev dependencies in production deadcode: build: -
[34m@effect/platform-node-shared[39m build: - [34m@effect/platform-node[39m
build: - [34mresolve-from[39m build: - [34mcallsites[39m build: -
[34mparent-module[39m build: - [34mimport-fresh[39m build: - [34mis-arrayish[39m
build: - [34merror-ex[39m build: - [34mjson-parse-even-better-errors[39m
deadcode: 5 Total deadcode: Health Summary deadcode: deadcode: 4681 Functions
analyzed deadcode: 0 Above threshold deadcode: 91.5 Average maintainability
(good) build: - [34mlines-and-columns[39m build: - [34mpicocolors[39m build: -
[34mjs-tokens[39m build: - [34m@babel/helper-validator-identifier[39m build: -
[34m@babel/code-frame[39m build: - [34mparse-json[39m build: - [34mjs-yaml[39m
build: - [34mtypescript[39m build: - [34mcosmiconfig[39m build: -
[34menv-paths[39m build: - [34myaml[39m build: - [34mmdast-util-to-string[39m
build: - [34mcharacter-entities[39m build: -
[34mdecode-named-character-reference[39m build: - [34mmicromark-util-chunked[39m
build: - [34mmicromark-util-combine-extensions[39m build: -
[34mmicromark-util-decode-numeric-character-reference[39m build: -
[34mmicromark-util-normalize-identifier[39m build: -
[34mmicromark-util-character[39m build: - [34mmicromark-factory-space[39m
build: - [34mmicromark[39m build: - [34mmicromark-util-classify-character[39m
build: - [34mmicromark-util-resolve-all[39m build: -
[34mmicromark-core-commonmark[39m build: - [34mmicromark-util-subtokenize[39m
build: - [34mmicromark-factory-destination[39m build: -
[34mmicromark-factory-label[39m build: - [34mmicromark-factory-title[39m
build: - [34mmicromark-factory-whitespace[39m build: -
[34mmicromark-util-html-tag-name[39m build: -
[34mmicromark-util-decode-string[39m build: -
[34munist-util-stringify-position[39m build: - [34mmdast-util-from-markdown[39m
build: - [34mdevlop[39m build: - [34mmdast-util-gfm-footnote[39m build: -
[34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34meta[39m build: -
[34mvscode-languageserver[39m build: - [34mvscode-jsonrpc[39m build: -
[34mvscode-languageserver-types[39m build: -
[34mvscode-languageserver-protocol[39m build: -
[34mvscode-languageserver-textdocument[39m build: - [34m@trpc/server[39m build:
[34mℹ[39m [38;2;155;180;100m[gtd][39m Granting execute permission to
[4mdist/gtd.bundle.mjs[24m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
[2mdist/[22m[1mgtd.bundle.mjs[22m [2m11.62 MB[22m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m 1 files, total: 11.62 MB build: [32m✔[39m
[38;2;155;180;100m[gtd][39m Build complete in [32m499ms[39m build: build: >
@pmelab/gtd@10.5.0 postbuild build: > jiti scripts/generate-schema.ts && node
scripts/assert-no-test-doubles.mjs build: test:e2e:live: cache miss, executing
337922b3ca9199cc test:unit: cache hit, replaying logs f6c571595dd0f966
test:e2e:inmem: cache hit, replaying logs dd24db1810d93df7 test:unit:
test:unit: > @pmelab/gtd@10.5.0 test:unit test:unit: > vitest run --project unit
test:unit: test:unit: Finished in 59ms on 1 files using 10 threads. test:unit:
Finished in 89ms on 1 files using 10 threads. test:unit: Finished in 147ms on 1
files using 10 threads. test:unit: (node:59325) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@10.5.0 test:e2e:inmem
test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem: test:e2e:live:
test:e2e:live: > @pmelab/gtd@10.5.0 test:e2e:live test:e2e:live: > vitest run
--project e2e-live --no-file-parallelism test:e2e:live: test:e2e:live:
test:e2e:live: FAIL Feature: A tick with no comment signs off —
build.review.deciding's script reaches idle > Scenario: a tick with no comment
signs off — deciding's script lands an ordinary commit entering idle (@live)
test:e2e:live: I run gtd land (#47) test:e2e:live: Step timed out after 120000ms
test:e2e:live: Error: I run gtd land (#47) test:e2e:live: test:e2e:live: FAIL
Feature: docs/driver.md's minimal driver — doc-tested against the loop
protocol > Scenario: Carries session continuity across a fix/check retry loop,
resuming within a scope (@live) test:e2e:live: I run the driver from the docs
(#833) test:e2e:live: Step timed out after 120000ms test:e2e:live: Error: I run
the driver from the docs (#833) test:e2e:live: test:e2e:live: FAIL Feature:
docs/driver.md's minimal driver — doc-tested against the loop protocol >
Scenario: A refused --resume (retention expired) recovers via the driver's own
|| fallback (@live) test:e2e:live: Test timed out in 300000ms. test:e2e:live: If
this is a long-running test, pass a timeout value as the last argument or
configure it globally with "testTimeout". test:e2e:live: Error:
STACK_TRACE_ERROR test:e2e:live: test:e2e:live: FAIL Feature: The green-baseline
entry gate — every entry runs the suite before starting > Scenario: a green
baseline proceeds from the gate into design.triage (@live) test:e2e:live: I run
gtd land (#172) test:e2e:live: Step timed out after 120000ms test:e2e:live:
Error: I run gtd land (#172) test:e2e:live: test:e2e:live: 4 test(s) failed
test:e2e:live: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/)
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/node_modules/.bin/npm run
test:e2e:live exited (1)

Tasks: 9 successful, 10 total Cached: 9 cached, 10 total Time: 58m35.529s
Failed: //#test:e2e:live

ERROR run failed: command exited (1)

<!-- gtd check 07c67541 -->
