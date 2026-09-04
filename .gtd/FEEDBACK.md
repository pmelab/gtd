> @pmelab/gtd@10.5.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live test:web deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, test:web, deadcode • Remote caching disabled, using shared
worktree cache

format:check: cache miss, executing 0cf24848e5de111f deadcode: cache miss,
executing 4ff91abd8d38c17a lint: cache miss, executing 17f436138486fd1f build:
cache miss, executing cbe95c3f12f501ac typecheck: cache miss, executing
60557ef4e3a6386b lint:sh: cache miss, executing 13ad8f0d83d8b7cc test:web: cache
hit, replaying logs 0e948dcf7f745d04 test:web: test:web: > @pmelab/gtd@10.5.0
test:web test:web: > vitest run --project storybook test:web: build: build: >
@pmelab/gtd@10.5.0 build build: > tsdown --filter web && node
scripts/inline-web-client.mjs && tsdown --filter gtd build: format:check:
format:check: > @pmelab/gtd@10.5.0 format:check format:check: > oxfmt --check .
format:check: typecheck: typecheck: > @pmelab/gtd@10.5.0 typecheck typecheck: >
tsc --noEmit && tsc --noEmit -p src/web/tsconfig.json typecheck: deadcode:
deadcode: > @pmelab/gtd@10.5.0 deadcode deadcode: > fallow --summary --quiet
deadcode: lint: lint: > @pmelab/gtd@10.5.0 lint lint: > oxlint . lint: lint:sh:
lint:sh: > @pmelab/gtd@10.5.0 lint:sh lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: format:check: Checking formatting...
format:check: lint: Found 0 warnings and 0 errors. lint: Finished in 43ms on 172
files with 116 rules using 10 threads. build: [34mℹ[39m [34mtsdown v0.22.8[39m
powered by [38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m tsconfig:
[38;2;100;116;180mtsconfig.json[39m build: [34mℹ[39m Build start lint:sh:
tests/shell/corpus/ is up to date (37 files) deadcode: Dead Code Summary
deadcode: deadcode: 5 Dev dependencies in production deadcode: deadcode: 5 Total
deadcode: Health Summary deadcode: deadcode: 4649 Functions analyzed deadcode: 0
Above threshold deadcode: 91.5 Average maintainability (good) build: [34mℹ[39m
[38;2;100;116;180m[web][39m Hint: consider adding [34mdeps.onlyBundle[39m option
to avoid unintended bundling of dependencies, or set [34mdeps.onlyBundle:
false[39m to disable this hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34mreact[39m build: -
[34m@tanstack/react-query[39m build: - [34m@tanstack/query-core[39m build: -
[34m@trpc/client[39m build: - [34m@trpc/server[39m build: - [34mscheduler[39m
build: - [34mreact-dom[39m build: - [34m@trpc/react-query[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.07 MB[22m build:
[34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.07 MB build: [32m✔[39m
[38;2;100;116;180m[web][39m Build complete in [32m155ms[39m build: [34mℹ[39m
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
[34m@effect/platform[39m build: - [34m@effect/platform-node-shared[39m build: -
[34m@effect/platform-node[39m build: - [34mresolve-from[39m build: -
[34mcallsites[39m build: - [34mparent-module[39m build: - [34mimport-fresh[39m
build: - [34mis-arrayish[39m build: - [34merror-ex[39m build: -
[34mjson-parse-even-better-errors[39m build: - [34mlines-and-columns[39m
build: - [34mpicocolors[39m build: - [34mjs-tokens[39m build: -
[34m@babel/helper-validator-identifier[39m build: - [34m@babel/code-frame[39m
build: - [34mparse-json[39m build: - [34mjs-yaml[39m build: - [34mtypescript[39m
build: - [34mcosmiconfig[39m build: - [34menv-paths[39m build: - [34myaml[39m
build: - [34mmdast-util-to-string[39m build: - [34mcharacter-entities[39m
build: - [34mdecode-named-character-reference[39m build: -
[34mmicromark-util-chunked[39m build: -
[34mmicromark-util-combine-extensions[39m build: -
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
[2mdist/[22m[1mgtd.bundle.mjs[22m [2m11.61 MB[22m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m 1 files, total: 11.61 MB build: [32m✔[39m
[38;2;155;180;100m[gtd][39m Build complete in [32m573ms[39m build: build: >
@pmelab/gtd@10.5.0 postbuild build: > jiti scripts/generate-schema.ts && node
scripts/assert-no-test-doubles.mjs build: test:e2e:live: cache miss, executing
f3da7c6283c09ec0 test:e2e:inmem: cache miss, executing 99a65940bb4a3878
test:unit: cache miss, executing ca8c666e6007b29c test:e2e:live:
test:e2e:live: > @pmelab/gtd@10.5.0 test:e2e:live test:e2e:live: > vitest run
--project e2e-live --no-file-parallelism test:e2e:live: test:e2e:inmem:
test:e2e:inmem: > @pmelab/gtd@10.5.0 test:e2e:inmem test:e2e:inmem: > vitest run
--project e2e-inmem test:e2e:inmem: test:unit: test:unit: > @pmelab/gtd@10.5.0
test:unit test:unit: > vitest run --project unit test:unit: test:unit: Finished
in 43ms on 1 files using 10 threads. test:unit: Finished in 122ms on 1 files
using 10 threads. test:unit: Finished in 125ms on 1 files using 10 threads.
test:unit: (node:90887) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED
environment variable to '0' makes TLS connections and HTTPS requests insecure by
disabling certificate verification. test:unit: (Use `node --trace-warnings ...`
to show where the warning was created) format:check: All matched files use the
correct format. format:check: Finished in 30430ms on 212 files using 10 threads.
test:unit: test:unit: FAIL formatAndValidateSteeringFile > never runs
`validate:` when `format:` failed test:unit: Test timed out in 30000ms.
test:unit: If this is a long-running test, pass a timeout value as the last
argument or configure it globally with "testTimeout". test:unit: Error:
STACK_TRACE_ERROR test:unit: test:unit: FAIL GitService [Live] > commitHistory >
returns all commits oldest to newest with their messages test:unit: Test timed
out in 30000ms. test:unit: If this is a long-running test, pass a timeout value
as the last argument or configure it globally with "testTimeout". test:unit:
Error: STACK_TRACE_ERROR test:unit: test:unit: FAIL %-safety and quoting >
round-trips arbitrary subjects (including % and quotes) through noteOutcome
test:unit: Test timed out in 30000ms. test:unit: If this is a long-running test,
pass a timeout value as the last argument or configure it globally with
"testTimeout". test:unit: Error: STACK_TRACE_ERROR test:unit: test:unit: FAIL
shellQuote > round-trips arbitrary strings — including newlines and non-ASCII —
through a real bash printf test:unit: Test timed out in 30000ms. test:unit: If
this is a long-running test, pass a timeout value as the last argument or
configure it globally with "testTimeout". test:unit: Error: STACK_TRACE_ERROR
test:unit: test:unit: 4 test(s) failed test:unit: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/)
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/node_modules/.bin/npm run
test:unit exited (1)

Tasks: 8 successful, 10 total Cached: 1 cached, 10 total Time: 2m11.354s Failed:
//#test:unit

ERROR run failed: command exited (1)

<!-- gtd check 60e93f3c -->
