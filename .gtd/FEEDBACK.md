> @pmelab/gtd@10.5.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live test:web deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, test:web, deadcode • Remote caching disabled, using shared
worktree cache

lint: cache miss, executing 7099abe39566fec0 lint:sh: cache miss, executing
a04d61bc028f32da typecheck: cache miss, executing 968f289ce06c1a2c test:web:
cache miss, executing 3cbbc4ee0629bda5 build: cache miss, executing
c397ac78370360b2 format:check: cache miss, executing bc74b8d3fe46b97e deadcode:
cache miss, executing f20b762a91d20f75 test:web: test:web: > @pmelab/gtd@10.5.0
test:web test:web: > vitest run --project storybook test:web: lint: lint: >
@pmelab/gtd@10.5.0 lint lint: > oxlint . lint: build: build: >
@pmelab/gtd@10.5.0 build build: > tsdown --filter web && node
scripts/inline-web-client.mjs && tsdown --filter gtd build: lint:sh: lint:sh: >
@pmelab/gtd@10.5.0 lint:sh lint:sh: > jiti scripts/generate-shell-corpus.ts
--check && shellcheck -s sh tests/shell/corpus/*.sh lint:sh: deadcode:
deadcode: > @pmelab/gtd@10.5.0 deadcode deadcode: > fallow --summary --quiet
deadcode: typecheck: typecheck: > @pmelab/gtd@10.5.0 typecheck typecheck: > tsc
--noEmit && tsc --noEmit -p src/web/tsconfig.json typecheck: format:check:
format:check: > @pmelab/gtd@10.5.0 format:check format:check: > oxfmt --check .
format:check: lint: Found 0 warnings and 0 errors. lint: Finished in 13ms on 203
files with 116 rules using 10 threads. build: [34mℹ[39m [34mtsdown v0.22.8[39m
powered by [38;2;255;126;23mrolldown v1.1.5[39m format:check: Checking
formatting... format:check: build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m tsconfig:
[38;2;100;116;180mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m [38;2;100;116;180m[web][39m Hint: consider adding
[34mdeps.onlyBundle[39m option to avoid unintended bundling of dependencies, or
set [34mdeps.onlyBundle: false[39m to disable this hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34mreact[39m build: -
[34m@tanstack/react-query[39m build: - [34m@tanstack/query-core[39m build: -
[34m@trpc/client[39m build: - [34m@trpc/server[39m build: - [34mscheduler[39m
build: - [34mreact-dom[39m build: - [34m@trpc/react-query[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.08 MB[22m build:
[34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.08 MB build: [32m✔[39m
[38;2;100;116;180m[web][39m Build complete in [32m118ms[39m build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m lint:sh:
tests/shell/corpus/ is up to date (37 files) build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;155;180;100m[gtd][39m entry:
[38;2;155;180;100msrc/main.ts[39m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
target: [38;2;155;180;100mnode20[39m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m tsconfig: [38;2;155;180;100mtsconfig.json[39m build:
[34mℹ[39m Build start build: [34mℹ[39m Cleaning 3 files deadcode: Health Summary
deadcode: deadcode: 5406 Functions analyzed deadcode: 0 Above threshold
deadcode: 91.5 Average maintainability (good) format:check: All matched files
use the correct format. format:check: Finished in 552ms on 240 files using 10
threads. build: [34mℹ[39m [38;2;155;180;100m[gtd][39m Hint: consider adding
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
[2mdist/[22m[1mgtd.bundle.mjs[22m [2m11.66 MB[22m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m 1 files, total: 11.66 MB build: [32m✔[39m
[38;2;155;180;100m[gtd][39m Build complete in [32m567ms[39m build: build: >
@pmelab/gtd@10.5.0 postbuild build: > jiti scripts/generate-schema.ts && node
scripts/assert-no-test-doubles.mjs build: test:e2e:inmem: cache miss, executing
9fb1f791e05d009a test:e2e:live: cache miss, executing c73e5ec6bc61612e
test:unit: cache miss, executing e0cf2f9094ee608e test:e2e:inmem:
test:e2e:inmem: > @pmelab/gtd@10.5.0 test:e2e:inmem test:e2e:inmem: > vitest run
--project e2e-inmem test:e2e:inmem: test:e2e:live: test:e2e:live: >
@pmelab/gtd@10.5.0 test:e2e:live test:e2e:live: > vitest run --project e2e-live
--no-file-parallelism test:e2e:live: test:unit: test:unit: > @pmelab/gtd@10.5.0
test:unit test:unit: > vitest run --project unit test:unit: test:unit: Finished
in 46ms on 1 files using 10 threads. test:unit: Finished in 107ms on 1 files
using 10 threads. test:unit: Finished in 83ms on 1 files using 10 threads.
test:unit: (node:91069) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED
environment variable to '0' makes TLS connections and HTTPS requests insecure by
disabling certificate verification. test:unit: (Use `node --trace-warnings ...`
to show where the warning was created) test:unit: test:unit: FAIL no ANSI, on a
pipe or a real tty > emits no escape byte under a real tty with a colour-capable
TERM test:unit: expected '' to contain '[commit] gtd(human): idle' test:unit:
AssertionError: expected '' to contain '[commit] gtd(human): idle' test:unit:
test:unit: 1 test(s) failed test:unit: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/)
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/node_modules/.bin/npm run
test:unit exited (1)

Tasks: 8 successful, 10 total Cached: 0 cached, 10 total Time: 39.81s Failed:
//#test:unit

ERROR run failed: command exited (1)

<!-- gtd check 0258d98a -->
