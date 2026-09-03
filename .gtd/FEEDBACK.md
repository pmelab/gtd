> @pmelab/gtd@10.4.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, deadcode • Remote caching disabled, using shared worktree cache

deadcode: cache miss, executing 51cf77797b1de599 test:unit: cache miss,
executing 597c767a5d8d0bda build: cache miss, executing a63fd2ecc344e8c9
lint:sh: cache miss, executing d55a85ef1f985689 lint: cache miss, executing
b3b4d44d45cd4fe3 format:check: cache miss, executing f6e40c657f17b6c8 typecheck:
cache miss, executing e99f019a066a7a30 test:e2e:inmem: cache miss, executing
4f86d949757f333f build: build: > @pmelab/gtd@10.4.0 build build: > tsdown build:
test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@10.4.0 test:e2e:inmem
test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem: format:check:
format:check: > @pmelab/gtd@10.4.0 format:check format:check: > oxfmt --check .
format:check: lint: lint: > @pmelab/gtd@10.4.0 lint lint: > oxlint . lint:
typecheck: typecheck: > @pmelab/gtd@10.4.0 typecheck typecheck: > tsc --noEmit
typecheck: lint:sh: lint:sh: > @pmelab/gtd@10.4.0 lint:sh lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: deadcode: deadcode: > @pmelab/gtd@10.4.0
deadcode deadcode: > fallow --summary --quiet deadcode: test:unit: test:unit: >
@pmelab/gtd@10.4.0 test:unit test:unit: > vitest run --project unit test:unit:
lint: Found 0 warnings and 0 errors. lint: Finished in 13ms on 143 files with 96
rules using 10 threads. format:check: Checking formatting... format:check:
build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown
v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/mdast/tsdown.config.ts[24m build:
[34mℹ[39m entry: [34msrc/main.ts[39m build: [34mℹ[39m target: [34mnode20[39m
build: [34mℹ[39m tsconfig: [34mtsconfig.json[39m build: [34mℹ[39m Build start
deadcode: Health Summary deadcode: deadcode: 4163 Functions analyzed deadcode: 0
Above threshold deadcode: 91.4 Average maintainability (good) lint:sh:
tests/shell/corpus/ is up to date (37 files) format:check: All matched files use
the correct format. format:check: Finished in 585ms on 178 files using 10
threads. test:unit: Finished in 23ms on 1 files using 10 threads. build:
[34mℹ[39m Hint: consider adding [34mdeps.onlyBundle[39m option to avoid
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
[34mvscode-languageserver-textdocument[39m build: [34mℹ[39m Granting execute
permission to [4mdist/gtd.bundle.mjs[24m build: [34mℹ[39m
[2mdist/[22m[1mgtd.bundle.mjs[22m [2m10.35 MB[22m build: [34mℹ[39m 1 files,
total: 10.35 MB build: [32m✔[39m Build complete in [32m1558ms[39m test:unit:
Finished in 43ms on 1 files using 10 threads. build: build: > @pmelab/gtd@10.4.0
postbuild build: > jiti scripts/generate-schema.ts && node
scripts/assert-no-test-doubles.mjs build: test:unit: Finished in 17ms on 1 files
using 10 threads. test:e2e:live: cache miss, executing 6e061c99c58006d3
test:e2e:live: test:e2e:live: > @pmelab/gtd@10.4.0 test:e2e:live
test:e2e:live: > vitest run --project e2e-live --no-file-parallelism
test:e2e:live: test:unit: test:unit: FAIL no ANSI, on a pipe or a real tty >
emits no escape byte under a real tty with a colour-capable TERM test:unit:
expected '' to contain '[commit] gtd(human): idle' test:unit: AssertionError:
expected '' to contain '[commit] gtd(human): idle' test:unit: test:unit: 1
test(s) failed test:unit: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/mdast/)
/Users/pmelab/.herdr/worktrees/gtd/mdast/node_modules/.bin/npm run test:unit
exited (1)

Tasks: 7 successful, 9 total Cached: 0 cached, 9 total Time: 35.92s Failed:
//#test:unit

ERROR run failed: command exited (1)

<!-- gtd check 0e048779 -->
