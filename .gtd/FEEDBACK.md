> @pmelab/gtd@10.5.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live test:web deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, test:web, deadcode • Remote caching disabled, using shared
worktree cache

lint: cache miss, executing c1fd427ee93130e6 deadcode: cache miss, executing
8f4056f31a18c839 typecheck: cache miss, executing 61b9b97a0216b85c lint:sh:
cache miss, executing 23128516aac7c64c format:check: cache miss, executing
ff766dcf712b315f test:web: cache miss, executing 0e948dcf7f745d04 build: cache
miss, executing aba854c3af75b15b lint:sh: lint:sh: > @pmelab/gtd@10.5.0 lint:sh
lint:sh: > jiti scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: format:check: format:check: >
@pmelab/gtd@10.5.0 format:check format:check: > oxfmt --check . format:check:
typecheck: typecheck: > @pmelab/gtd@10.5.0 typecheck typecheck: > tsc --noEmit
&& tsc --noEmit -p src/web/tsconfig.json typecheck: lint: lint: >
@pmelab/gtd@10.5.0 lint lint: > oxlint . lint: build: build: >
@pmelab/gtd@10.5.0 build build: > tsdown --filter web && node
scripts/inline-web-client.mjs && tsdown --filter gtd build: test:web:
test:web: > @pmelab/gtd@10.5.0 test:web test:web: > vitest run --project
storybook test:web: deadcode: deadcode: > @pmelab/gtd@10.5.0 deadcode
deadcode: > fallow --summary --quiet deadcode: format:check: Checking
formatting... format:check: build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m lint: Found 0 warnings and 0 errors. lint:
Finished in 103ms on 172 files with 116 rules using 10 threads. build: [34mℹ[39m
config file:
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
[38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.07 MB[22m build:
[34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.07 MB build: [32m✔[39m
[38;2;100;116;180m[web][39m Build complete in [32m151ms[39m lint:sh:
tests/shell/corpus/ is up to date (37 files) deadcode: Dead Code Summary
deadcode: deadcode: 5 Dev dependencies in production deadcode: deadcode: 5 Total
deadcode: Health Summary deadcode: deadcode: 4648 Functions analyzed deadcode: 0
Above threshold deadcode: 91.5 Average maintainability (good) build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;155;180;100m[gtd][39m entry:
[38;2;155;180;100msrc/main.ts[39m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
target: [38;2;155;180;100mnode20[39m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m tsconfig: [38;2;155;180;100mtsconfig.json[39m build:
[34mℹ[39m Build start build: [34mℹ[39m Cleaning 3 files format:check: All
matched files use the correct format. format:check: Finished in 556ms on 211
files using 10 threads. build: [34mℹ[39m [38;2;155;180;100m[gtd][39m Hint:
consider adding [34mdeps.onlyBundle[39m option to avoid unintended bundling of
dependencies, or set [34mdeps.onlyBundle: false[39m to disable this hint. build:
See more at [4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m
build: Detected dependencies in bundle: build: - [34meffect[39m build: -
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
[38;2;155;180;100m[gtd][39m Build complete in [32m504ms[39m build: build: >
@pmelab/gtd@10.5.0 postbuild build: > jiti scripts/generate-schema.ts && node
scripts/assert-no-test-doubles.mjs build: test:unit: cache miss, executing
210eba3d62d5d1f8 test:e2e:inmem: cache miss, executing d81ed854284c465d
test:e2e:live: cache miss, executing f126886f51928afe test:unit: test:unit: >
@pmelab/gtd@10.5.0 test:unit test:unit: > vitest run --project unit test:unit:
test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@10.5.0 test:e2e:inmem
test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem: test:e2e:live:
test:e2e:live: > @pmelab/gtd@10.5.0 test:e2e:live test:e2e:live: > vitest run
--project e2e-live --no-file-parallelism test:e2e:live: test:unit: Finished in
82ms on 1 files using 10 threads. test:unit: Finished in 119ms on 1 files using
10 threads. test:unit: Finished in 17ms on 1 files using 10 threads. test:unit:
(node:9544) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED environment
variable to '0' makes TLS connections and HTTPS requests insecure by disabling
certificate verification. test:unit: (Use `node --trace-warnings ...` to show
where the warning was created) test:e2e:live: test:e2e:live: FAIL Feature:
docs/driver.md's minimal driver — doc-tested against the loop protocol >
Scenario: Chains an agent turn through a check turn and halts back at the human
gate (@live) test:e2e:live: it succeeds (#73) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:73:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: A check script's own cleanup
mechanic (a sole swept deletion) advances the process instead of stalling
(@live) test:e2e:live: it succeeds (#137) test:e2e:live: exit 1 test:e2e:live:
stderr: node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:137:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: Captures the human's pending
edit at the opening gate, so the human only runs the driver (@live)
test:e2e:live: it succeeds (#200) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:200:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: A mid-process restart resumes
driving instead of failing at the opening capture (@live) test:e2e:live: it
succeeds (#237) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:237:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: Accepts a gate by inaction on
the opening beat, driving on past it (@live) test:e2e:live: it succeeds (#280)
test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:280:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: Shows the same gate instead of
accepting it when the run itself produced it (@live) test:e2e:live: it succeeds
(#336) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:336:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: Settles instead of looping
forever when a script rest makes no progress (@live) test:e2e:live: it succeeds
(#368) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:368:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: Stops instead of spinning when
the agent's turn makes no progress (@live) test:e2e:live: Scenario finished with
1 errors: test:e2e:live: test:e2e:live: stderr contains "stalled at \"working\""
(#409) test:e2e:live: Expected stderr to contain "stalled at "working"". Got:
test:e2e:live: node:internal/modules/cjs/loader:1517 test:e2e:live: const err =
new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:409:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: A retry cap redirects a
would-be stall to a human gate instead of halting (@live) test:e2e:live: it
succeeds (#462) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:462:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: A dirty human gate reached
mid-run is a capture beat — landed outright, never halting the driver (@live)
test:e2e:live: it succeeds (#498) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:498:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: Runs the self-validation gate
after a producing agent turn and re-prompts until the steering file is
well-formed (@live) test:e2e:live: it succeeds (#573) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:573:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: Stops instead of stepping when
a steering file still fails validation after 3 fix attempts (@live)
test:e2e:live: stderr contains "has no question text" (#632) test:e2e:live:
Expected stderr to contain "has no question text". Got: test:e2e:live:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:632:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: Redirects the check script's
own output to the log file instead of the terminal (@live) test:e2e:live: it
succeeds (#665) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:665:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: A check script that exits
non-zero still lets the pattern decide the outcome (@live) test:e2e:live: it
succeeds (#704) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:704:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: A failing agent CLI stops the
run instead of stepping past it (@live) test:e2e:live: the log file contains
"BOOM: agent exploded" (#749) test:e2e:live: Expected the log file
(".git/gtd-loop.log") to contain "BOOM: agent exploded". Got: test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:749:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: Carries session continuity
across a fix/check retry loop, resuming within a scope (@live) test:e2e:live: it
succeeds (#834) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:834:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: A scope's session survives an
interleaved turn in a nested, different scope (@live) test:e2e:live: it succeeds
(#924) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:924:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: A refused --session-id (the
crash edge's symptom) recovers via the driver's own || fallback (@live)
test:e2e:live: it succeeds (#986) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:986:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: A refused --resume (retention
expired) recovers via the driver's own || fallback (@live) test:e2e:live: it
succeeds (#1054) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:1054:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: A still-red suite with
byte-identical output escalates instead of false-greening into review (@live)
test:e2e:live: it succeeds (#1082) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:1082:1
test:e2e:live: test:e2e:live: FAIL Feature: docs/driver.md's minimal driver —
doc-tested against the loop protocol > Scenario: --entry fix-precheck on a green
baseline lands an ordinary probe commit, then halts at idle (@live)
test:e2e:live: it succeeds (#1099) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/driver-doc.feature:1099:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: gtd validate
reports a custom mode's validate command as findings and exits non-zero (@live)
test:e2e:live: stderr contains ".gtd/docs/adr.md is not valid" (#73)
test:e2e:live: Expected stderr to contain ".gtd/docs/adr.md is not valid". Got:
test:e2e:live: node:internal/modules/cjs/loader:1517 test:e2e:live: const err =
new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:73:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: gtd validate exits
0 when the custom mode's validate command is happy (@live) test:e2e:live: it
succeeds (#159) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:159:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: the mode's format
command rewrites the file in place before validation (@live) test:e2e:live: it
succeeds (#243) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:243:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: gtd land no longer
runs the mode's validate command — an invalid custom-mode steering file lands
regardless (@live) test:e2e:live: it succeeds (#348) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:348:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: a valid custom-mode
steering file passes the gate and the turn is captured (@live) test:e2e:live: it
succeeds (#445) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:445:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: gtd land no longer
runs the mode's format command at all — a broken formatter can't block the
commit any more (@live) test:e2e:live: it succeeds (#491) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:491:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: a modes: entry
named after a built-in overrides only the half it declares (@live)
test:e2e:live: Scenario finished with 1 errors: test:e2e:live: test:e2e:live:
stderr contains "my house rule" (#584) test:e2e:live: Expected stderr to contain
"my house rule". Got: test:e2e:live: node:internal/modules/cjs/loader:1517
test:e2e:live: const err = new Error(message); test:e2e:live: ^ test:e2e:live:
test:e2e:live: Error: Cannot find module '../../package.json' test:e2e:live:
Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:584:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: declaring only a
format: for a built-in mode KEEPS gtd's own validation (@live) test:e2e:live:
Scenario finished with 1 errors: test:e2e:live: test:e2e:live: stderr contains
"has no question text" (#629) test:e2e:live: Expected stderr to contain "has no
question text". Got: test:e2e:live: node:internal/modules/cjs/loader:1517
test:e2e:live: const err = new Error(message); test:e2e:live: ^ test:e2e:live:
test:e2e:live: Error: Cannot find module '../../package.json' test:e2e:live:
Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:629:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: a top-level modes:
key plugs a formatter into a workflow without re-declaring its modes (@live)
test:e2e:live: it succeeds (#668) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:668:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: a top-level modes:
entry layers over the workflow's own, half by half (@live) test:e2e:live: it
succeeds (#709) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:709:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: a custom mode
declaring only format: formats the file and has nothing to validate (@live)
test:e2e:live: it succeeds (#745) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:745:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: a format-only
custom mode at a first-write beat now emits a script (the guard plus the format
command), not "nothing to validate" (@live) test:e2e:live: it succeeds (#784)
test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:784:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: a seeded validate:
command's bare "gtd" resolves to the build under test (@live) test:e2e:live:
stderr contains "path-shim:" (#904) test:e2e:live: Expected stderr to contain
"path-shim:". Got: test:e2e:live: node:internal/modules/cjs/loader:1517
test:e2e:live: const err = new Error(message); test:e2e:live: ^ test:e2e:live:
test:e2e:live: Error: Cannot find module '../../package.json' test:e2e:live:
Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:904:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: a validate: that
shells out to `gtd check qa` returns each finding as an opaque message with the
column riding inside the text, not a structured position (@live) test:e2e:live:
Scenario finished with 1 errors: test:e2e:live: test:e2e:live: stderr contains
".gtd/docs/PLAN.md:9:1: A '##' section appears after '## Answered Questions',
which must come last" (#956) test:e2e:live: Expected stderr to contain
".gtd/docs/PLAN.md:9:1: A '##' section appears after '## Answered Questions',
which must come last". Got: test:e2e:live: node:internal/modules/cjs/loader:1517
test:e2e:live: const err = new Error(message); test:e2e:live: ^ test:e2e:live:
test:e2e:live: Error: Cannot find module '../../package.json' test:e2e:live:
Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:956:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: a built-in mode
paired with a format: that breaks its own validator is caught before any real
file exists (@live) test:e2e:live: stderr contains "mode \"review\"" (#1004)
test:e2e:live: Expected stderr to contain "mode "review"". Got: test:e2e:live:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:1004:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: the same repo with
the formatter removed exits 0 — no contradiction to find (@live) test:e2e:live:
Scenario finished with 1 errors: test:e2e:live: test:e2e:live: it succeeds
(#1040) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:1040:1
test:e2e:live: test:e2e:live: FAIL Feature: Pluggable steering-file modes — a
mode is a format command plus a validate command > Scenario: a mode carrying
only a user validate: command prints that the contradiction check was skipped,
loudly (@live) test:e2e:live: it succeeds (#1082) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/steering-modes.feature:1082:1
test:e2e:live: test:e2e:live: FAIL Feature: Markdown formatting is the project's
own tool, plugged into a steering-file mode > Scenario: prettier plugged into
the workflow's qa mode via a top-level modes: key rewraps TODO.md (@live)
test:e2e:live: it succeeds (#60) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/formatting.feature:60:1
test:e2e:live: test:e2e:live: FAIL Feature: Markdown formatting is the project's
own tool, plugged into a steering-file mode > Scenario: gtd land no longer
formats before committing the turn — gtd validate is what still runs the mode's
format command (@live) test:e2e:live: it succeeds (#113) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/formatting.feature:113:1
test:e2e:live: test:e2e:live: FAIL Feature: Markdown formatting is the project's
own tool, plugged into a steering-file mode > Scenario: prettier plugged into
the bundled default's qa mode via a top-level modes: key formats the
agent-authored requirements at design.triage, when gtd validate runs it first
(@live) test:e2e:live: it succeeds (#180) test:e2e:live: exit 1 test:e2e:live:
stderr: node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/formatting.feature:180:1
test:e2e:live: test:e2e:live: FAIL Feature: Markdown formatting is the project's
own tool, plugged into a steering-file mode > Scenario: prettier plugged into
the bundled default's qa mode formats the human-edited requirements at
design.gate.answer, when gtd validate runs it first (@live) test:e2e:live: it
succeeds (#204) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/formatting.feature:204:1
test:e2e:live: test:e2e:live: FAIL Feature: Markdown formatting is the project's
own tool, plugged into a steering-file mode > Scenario: gtd validate formats the
requirements file at design.triage and reports it valid — plain prose with no
Open Questions passes the qa validator trivially (@live) test:e2e:live: it
succeeds (#224) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/formatting.feature:224:1
test:e2e:live: test:e2e:live: FAIL Feature: Review checkboxes reset on land — a
tick is read-progress, never sign-off > Scenario: ticking boxes and changing
nothing else is a clean sign-off — the ticks are gone from disk and the round
reaches idle (@live) test:e2e:live: it succeeds (#46) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/review-tick-reset.feature:46:1
test:e2e:live: test:e2e:live: FAIL Feature: Review checkboxes reset on land — a
tick is read-progress, never sign-off > Scenario: ticking boxes and leaving a
note is feedback — the commit carries the note, no tick, and routes to
collecting (@live) test:e2e:live: it succeeds (#79) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/review-tick-reset.feature:79:1
test:e2e:live: test:e2e:live: FAIL Feature: Review checkboxes reset on land — a
tick is read-progress, never sign-off > Scenario: ticking a two-space-indented
(nested) hunk is cleared at the review gate too — the live bug this rewrite
fixes (@live) test:e2e:live: it succeeds (#113) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/review-tick-reset.feature:113:1
test:e2e:live: test:e2e:live: FAIL Feature: Review checkboxes reset on land — a
tick is read-progress, never sign-off > Scenario: a '- [x]' line inside a fenced
code block in a chunk description is never a hunk pointer, and ticking the chunk
never touches it (@live) test:e2e:live: it succeeds (#160) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/review-tick-reset.feature:160:1
test:e2e:live: test:e2e:live: FAIL Feature: Review checkboxes reset on land — a
tick is read-progress, never sign-off > Scenario: a ticked answer at a qa-mode
gate survives the land — gtd uncheck never runs there (@live) test:e2e:live: it
succeeds (#193) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/review-tick-reset.feature:193:1
test:e2e:live: test:e2e:live: FAIL Feature: The bundled unified workflow — one
flow, end to end > Scenario: re-unwind actually reverts a hand-edited code line,
never resurrects the review file, and leaves the state dir alone (@live)
test:e2e:live: it succeeds (#467) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/default-workflow.feature:467:1
test:e2e:live: test:e2e:live: FAIL Feature: The bundled unified workflow — one
flow, end to end > Scenario: re-unwind on a note-only review round applies no
patch (an empty patch is not a valid git apply input) and the C row still
advances to design.triage (@live) test:e2e:live: it succeeds (#506)
test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/default-workflow.feature:506:1
test:e2e:live: test:e2e:live: FAIL Feature: The bundled unified workflow — one
flow, end to end > Scenario: a genuinely failing `git apply -R` is refused, not
silently swallowed (@live) test:e2e:live: it succeeds (#551) test:e2e:live: exit
1 test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/default-workflow.feature:551:1
test:e2e:live: test:e2e:live: FAIL Feature: The bundled unified workflow — one
flow, end to end > Scenario: two consecutive open-questions rounds both rest at
the gate — the marker's HEAD stamp regression (design.gate.check) (@live)
test:e2e:live: it succeeds (#723) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/default-workflow.feature:723:1
test:e2e:live: test:e2e:live: FAIL Feature: The bundled unified workflow — one
flow, end to end > Scenario: gtd next at await-review leaves HEAD untouched and
writes no worktree ref (@live) test:e2e:live: it succeeds (#1136) test:e2e:live:
exit 1 test:e2e:live: stderr: node:internal/modules/cjs/loader:1517
test:e2e:live: const err = new Error(message); test:e2e:live: ^ test:e2e:live:
test:e2e:live: Error: Cannot find module '../../package.json' test:e2e:live:
Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/default-workflow.feature:1136:1
test:e2e:live: test:e2e:live: FAIL Feature: The green-baseline entry gate —
every entry runs the suite before starting > Scenario: a green baseline proceeds
from the gate into design.triage (@live) test:e2e:live: it succeeds (#158)
test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/entry-gate.feature:158:1
test:e2e:live: test:e2e:live: FAIL Feature: The green-baseline entry gate —
every entry runs the suite before starting > Scenario: the unwind reverts a note
and a hand-edited code change alike, restoring the start commit while both
survive in the entry commit (@live) test:e2e:live: it succeeds (#191)
test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/entry-gate.feature:191:1
test:e2e:live: test:e2e:live: FAIL Feature: The green-baseline entry gate —
every entry runs the suite before starting > Scenario: a red baseline halts at
start-gate.blocked with the failing output recorded (@live) test:e2e:live: it
succeeds (#225) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/entry-gate.feature:225:1
test:e2e:live: test:e2e:live: FAIL Feature: Reads are safe to poll — a settled
rest answers identically and mutates nothing > Scenario: repeated reads at a
resting prompt turn change nothing — session, memory, and model all stay put
(@live) test:e2e:live: it succeeds (#22) test:e2e:live: exit 1 test:e2e:live:
stderr: node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/poll-safety.feature:22:1
test:e2e:live: test:e2e:live: FAIL Feature: Reads are safe to poll — a settled
rest answers identically and mutates nothing > Scenario: repeated reads at a
settled gate change nothing (@live) test:e2e:live: it succeeds (#41)
test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/poll-safety.feature:41:1
test:e2e:live: test:e2e:live: FAIL Feature: Reads are safe to poll — a settled
rest answers identically and mutates nothing > Scenario: negative control — the
snapshot helper actually detects a real write (@live) test:e2e:live: it succeeds
(#65) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/poll-safety.feature:65:1
test:e2e:live: test:e2e:live: FAIL Feature: the voice survives the parsers it
shares a prompt with (package 03, task 3) > Scenario: a styled REQUIREMENTS.md
passes gtd check qa and design.triage advances (@live) test:e2e:live: it
succeeds (#53) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/styled-steering.feature:53:1
test:e2e:live: test:e2e:live: FAIL Feature: the voice survives the parsers it
shares a prompt with (package 03, task 3) > Scenario: a styled REVIEW.md passes
gtd check review and build.review.reviewing advances (@live) test:e2e:live: it
succeeds (#86) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/styled-steering.feature:86:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd lsp — the steering-file LSP
server (stdio) > Scenario: the initialize handshake succeeds and advertises
symbol/code-action support (@live) test:e2e:live: the LSP client sends an
initialize request (#29) test:e2e:live: LSP request "initialize" timed out
waiting for a response test:e2e:live: Error: the LSP client sends an initialize
request (#29) test:e2e:live: test:e2e:live: FAIL Feature: gtd lsp — the
steering-file LSP server (stdio) > Scenario: with no config, .gtd/TODO.md is NOT
dispatched by basename — it yields no symbols (@live) test:e2e:live: the LSP
client sends an initialize request (#37) test:e2e:live: LSP request "initialize"
timed out waiting for a response test:e2e:live: Error: the LSP client sends an
initialize request (#37) test:e2e:live: test:e2e:live: FAIL Feature: gtd lsp —
the steering-file LSP server (stdio) > Scenario: documentSymbol is served for a
CUSTOM-named qa file mapped via a real .gtdrc (config-driven dispatch) (@live)
test:e2e:live: the LSP client sends an initialize request (#77) test:e2e:live:
LSP request "initialize" timed out waiting for a response test:e2e:live: Error:
the LSP client sends an initialize request (#77) test:e2e:live: test:e2e:live:
FAIL Feature: gtd lsp — the steering-file LSP server (stdio) > Scenario:
gtd.openSteeringFile resolves the current state's steering file and asks the
client to show it (@live) test:e2e:live: the LSP client sends an initialize
request (#121) test:e2e:live: LSP request "initialize" timed out waiting for a
response test:e2e:live: Error: the LSP client sends an initialize request (#121)
test:e2e:live: test:e2e:live: FAIL Feature: gtd lsp — the steering-file LSP
server (stdio) > Scenario: gtd.openSteeringFile renders file: with the process's
own entry vars, matching what gtd next reports (issue #156) (@live)
test:e2e:live: the LSP client sends an initialize request (#169) test:e2e:live:
LSP request "initialize" timed out waiting for a response test:e2e:live: Error:
the LSP client sends an initialize request (#169) test:e2e:live: test:e2e:live:
FAIL Feature: gtd lsp — the steering-file LSP server (stdio) > Scenario:
initialize advertises definition support and a definition on a hunk line jumps
into the file (@live) test:e2e:live: the LSP client sends an initialize request
(#178) test:e2e:live: LSP request "initialize" timed out waiting for a response
test:e2e:live: Error: the LSP client sends an initialize request (#178)
test:e2e:live: test:e2e:live: FAIL Feature: gtd lsp — the steering-file LSP
server (stdio) > Scenario: a definition on a hunk whose path contains hyphens
jumps to the file, not a parent folder (@live) test:e2e:live: the LSP client
sends an initialize request (#201) test:e2e:live: LSP request "initialize" timed
out waiting for a response test:e2e:live: Error: the LSP client sends an
initialize request (#201) test:e2e:live: test:e2e:live: FAIL Feature: gtd lsp —
the steering-file LSP server (stdio) > Scenario: a code action is offered on a
wrapped option's continuation line, not just its checkbox line (@live)
test:e2e:live: the LSP client sends an initialize request (#241) test:e2e:live:
LSP request "initialize" timed out waiting for a response test:e2e:live: Error:
the LSP client sends an initialize request (#241) test:e2e:live: test:e2e:live:
FAIL Feature: gtd lsp — the steering-file LSP server (stdio) > Scenario: a
modes: qa validate: override suppresses built-in diagnostics for a live notice,
while the outline stays live (@live) test:e2e:live: the LSP client sends an
initialize request (#293) test:e2e:live: LSP request "initialize" timed out
waiting for a response test:e2e:live: Error: the LSP client sends an initialize
request (#293) test:e2e:live: test:e2e:live: FAIL Feature: gtd lsp — the
steering-file LSP server (stdio) > Scenario: a modes: qa validate: entry
carrying gtd's own SEEDED command keeps live diagnostics, not the external
notice (@live) test:e2e:live: the LSP client sends an initialize request (#345)
test:e2e:live: LSP request "initialize" timed out waiting for a response
test:e2e:live: Error: the LSP client sends an initialize request (#345)
test:e2e:live: test:e2e:live: FAIL Feature: gtd lsp — the steering-file LSP
server (stdio) > Scenario: 'gtd: add a footnote' inserts a marker and a seeded
definition; applying the edits shows both (@live) test:e2e:live: the LSP client
sends an initialize request (#363) test:e2e:live: LSP request "initialize" timed
out waiting for a response test:e2e:live: Error: the LSP client sends an
initialize request (#363) test:e2e:live: test:e2e:live: FAIL Feature: gtd lsp —
the steering-file LSP server (stdio) > Scenario: a textDocument/definition round
trip jumps marker to definition, then definition back to the marker's exact
column (@live) test:e2e:live: the LSP client sends an initialize request (#383)
test:e2e:live: LSP request "initialize" timed out waiting for a response
test:e2e:live: Error: the LSP client sends an initialize request (#383)
test:e2e:live: test:e2e:live: FAIL Feature: gtd lsp — the steering-file LSP
server (stdio) > Scenario: a marker in a qa file jumps to its definition —
proving qa now serves pointerAt (@live) test:e2e:live: the LSP client sends an
initialize request (#439) test:e2e:live: LSP request "initialize" timed out
waiting for a response test:e2e:live: Error: the LSP client sends an initialize
request (#439) test:e2e:live: test:e2e:live: FAIL Feature: A tick with no
comment signs off — build.review.deciding's script reaches idle > Scenario: a
tick with no comment signs off — deciding's script lands an ordinary commit
entering idle (@live) test:e2e:live: it succeeds (#48) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/deciding-signoff.feature:48:1
test:e2e:live: test:e2e:live: FAIL Feature: A tick with no comment signs off —
build.review.deciding's script reaches idle > Scenario: no `.gtd/REVIEW.md` at
HEAD is not a sign-off — deciding's script writes FEEDBACK.md and lands at a
human gate (@live @live) test:e2e:live: I execute the printed check script (#67)
test:e2e:live: Unexpected end of JSON input test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/deciding-signoff.feature:67:1
test:e2e:live: test:e2e:live: FAIL Feature: A signal death reports the promised
exit status and leaves nothing half-written > Scenario: SIGINT kills a spawned
gtd next with status 130 (@live) test:e2e:live: the reported exit status is 130
(#28) test:e2e:live: Expected exit status 130. Got status 1 (code=1,
signal=null). test:e2e:live: test:e2e:live: 1 !== 130 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/signal-exit.feature:28:1
test:e2e:live: test:e2e:live: FAIL Feature: A signal death reports the promised
exit status and leaves nothing half-written > Scenario: SIGTERM kills a spawned
gtd next with status 143 (@live) test:e2e:live: the reported exit status is 143
(#41) test:e2e:live: Expected exit status 143. Got status 1 (code=1,
signal=null). test:e2e:live: test:e2e:live: 1 !== 143 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/signal-exit.feature:41:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd summary — prints the
closing-message prompt, writing nothing > Scenario: gtd summary writes nothing —
the repository is byte-identical before and after the call (@live)
test:e2e:live: it succeeds (#134) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/summary.feature:134:1
test:e2e:live: test:e2e:live: FAIL Feature: Emitted required/optional scripts
print their own outcome lines > Scenario: a landed transition's required script
prints the transition row (@live) test:e2e:live: it succeeds (#43)
test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/script-outcomes.feature:43:1
test:e2e:live: test:e2e:live: FAIL Feature: Emitted required/optional scripts
print their own outcome lines > Scenario: a no-op step's required script is
print-only, naming the resting state (@live) test:e2e:live: it succeeds (#48)
test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/script-outcomes.feature:48:1
test:e2e:live: test:e2e:live: FAIL Feature: Emitted required/optional scripts
print their own outcome lines > Scenario: gtd abandon's script resolves the
post-hoc short hash and subject from the resulting HEAD (@live) test:e2e:live:
it succeeds (#58) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/script-outcomes.feature:58:1
test:e2e:live: test:e2e:live: FAIL Feature: A review sign-off lands even when
its mode declares a format: command that fails on a missing file > Scenario: the
sign-off still lands when the review mode declares a format command that fails
on a missing file (@live) test:e2e:live: it succeeds (#61) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/review-signoff-format-skip.feature:61:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd base — prints the review anchor
hash, writing nothing > Scenario: gtd base writes nothing — the repository is
byte-identical before and after the call (@live) test:e2e:live: it succeeds
(#234) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/base.feature:234:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd init — seed a minimal
.gtdrc.json (default vars + formatting) > Scenario: gtd init writes an
uncommitted minimal .gtdrc.json with default vars and modes (@live)
test:e2e:live: it succeeds (#17) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/init.feature:17:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd init — seed a minimal
.gtdrc.json (default vars + formatting) > Scenario: gtd init rejects a workflow
argument (@live) test:e2e:live: stderr contains "too many arguments" (#44)
test:e2e:live: Expected stderr to contain "too many arguments". Got:
test:e2e:live: node:internal/modules/cjs/loader:1517 test:e2e:live: const err =
new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/init.feature:44:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd init — seed a minimal
.gtdrc.json (default vars + formatting) > Scenario: gtd init refuses to
overwrite an existing gtd config (@live) test:e2e:live: Scenario finished with 1
errors: test:e2e:live: test:e2e:live: stderr contains "already exists" (#52)
test:e2e:live: Expected stderr to contain "already exists". Got: test:e2e:live:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/init.feature:52:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd init — seed a minimal
.gtdrc.json (default vars + formatting) > Scenario: gtd init succeeds when only
an ancestor directory carries a gtd config (@live) test:e2e:live: it succeeds
(#59) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/init.feature:59:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd init — seed a minimal
.gtdrc.json (default vars + formatting) > Scenario: a state command with no
config runs on the built-in default workflow (@live) test:e2e:live: it succeeds
(#67) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/init.feature:67:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd init — seed a minimal
.gtdrc.json (default vars + formatting) > Scenario: gtd init runs outside any
git repository (@live) test:e2e:live: it succeeds (#77) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/init.feature:77:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd init — seed a minimal
.gtdrc.json (default vars + formatting) > Scenario: gtd init refuses to scaffold
into a repository subdirectory (@live) test:e2e:live: stderr contains
"subdirectory" (#89) test:e2e:live: Expected stderr to contain "subdirectory".
Got: test:e2e:live: node:internal/modules/cjs/loader:1517 test:e2e:live: const
err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error:
Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/init.feature:89:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd's own stdout never carries a
real ANSI escape byte > Scenario: no escape sequence appears in gtd's own stdout
for a message, a prompt, a script and a land (live tier) (@live) test:e2e:live:
it succeeds (#99) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/ansi-free-stdout.feature:99:1
test:e2e:live: test:e2e:live: FAIL Feature: A large prompt survives its exit
through a pipe > Scenario: gtd next's large prompt is not truncated when piped
into a slow consumer (@live) test:e2e:live: the direct byte count exceeds 65536
bytes (#25) test:e2e:live: Expected the direct-redirect byte count to exceed
65536, got 0 test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/pipe-truncation.feature:25:1
test:e2e:live: test:e2e:live: FAIL Feature: Honoring $TMPDIR and $GIT_DIR — gtd
assumes nothing about /tmp or <cwd>/.git > Scenario: a full beat lands correctly
with the git dir relocated outside the worktree and TMPDIR pointed elsewhere
(@live) test:e2e:live: it succeeds (#25) test:e2e:live: exit 1 test:e2e:live:
stderr: node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/tmpdir-and-git-dir.feature:25:1
test:e2e:live: test:e2e:live: FAIL Feature: Honoring $TMPDIR and $GIT_DIR — gtd
assumes nothing about /tmp or <cwd>/.git > Scenario: the emitted validate script
may write under TMPDIR while gtd itself still writes nothing there (@live)
test:e2e:live: it succeeds (#70) test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/tmpdir-and-git-dir.feature:70:1
test:e2e:live: test:e2e:live: FAIL Feature: Prompts carry diff RANGES, never
diff CONTENT > Scenario: build.review.deciding's captured manifest names a
commit and a path, never inlines a diff (@live) test:e2e:live: I execute the
printed check script (#66) test:e2e:live: Unexpected end of JSON input
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/prompt-diff-ranges.feature:66:1
test:e2e:live: test:e2e:live: FAIL Feature: Emitted scripts actually run under a
real POSIX shell (dash), not just bash-flavored sh > Scenario: the
mode-contradiction round-trip (package 2) also runs under dash, not just
bash-flavored sh (@live) test:e2e:live: stderr contains "CONFIGURATION BUG"
(#63) test:e2e:live: Expected stderr to contain "CONFIGURATION BUG". Got:
test:e2e:live: node:internal/modules/cjs/loader:1517 test:e2e:live: const err =
new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/emitted-scripts-under-dash.feature:63:1
test:e2e:live: test:e2e:live: FAIL Feature: A "./"-relative content value is a
file reference, inlined at load time > Scenario: a "./"-relative prompt value is
inlined from a file next to the config (@live) test:e2e:live: it succeeds (#47)
test:e2e:live: exit 1 test:e2e:live: stderr:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/config-file-refs.feature:47:1
test:e2e:live: test:e2e:live: FAIL Feature: A "./"-relative content value is a
file reference, inlined at load time > Scenario: a missing "./"-relative content
value is a load error naming the file and state (@live) test:e2e:live: stderr
contains "missing-message.md" (#74) test:e2e:live: Expected stderr to contain
"missing-message.md". Got: test:e2e:live: node:internal/modules/cjs/loader:1517
test:e2e:live: const err = new Error(message); test:e2e:live: ^ test:e2e:live:
test:e2e:live: Error: Cannot find module '../../package.json' test:e2e:live:
Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/config-file-refs.feature:74:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd land — the one landing verb,
actorless > Scenario: gtd land --json=script piped straight into sh lands the
turn (@live) test:e2e:live: Scenario finished with 1 errors: test:e2e:live:
test:e2e:live: the last commit subject is "gtd(human): idle → working" (#313)
test:e2e:live: Expected last commit subject "gtd(human): idle → working". Got
"chore: add .gtdrc". test:e2e:live: Log: test:e2e:live: 45773bb chore: add
.gtdrc test:e2e:live: ce51207 chore: initial commit test:e2e:live:
test:e2e:live: + actual - expected test:e2e:live: test:e2e:live: + 'chore: add
.gtdrc' test:e2e:live: - 'gtd(human): idle → working' test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/land.feature:313:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd in a repository with no commits
yet > Scenario: gtd land refuses in a repository with no commits (@live)
test:e2e:live: stderr contains "gtd requires a repository with at least one
commit — make an initial commit, then run gtd again" (#28) test:e2e:live:
Expected stderr to contain "gtd requires a repository with at least one commit —
make an initial commit, then run gtd again". Got: test:e2e:live:
node:internal/modules/cjs/loader:1517 test:e2e:live: const err = new
Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live: Error: Cannot
find module '../../package.json' test:e2e:live: Require stack: test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/empty-repository.feature:28:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd in a repository with no commits
yet > Scenario: gtd init is exempt — it still succeeds in a repository with no
commits (@live) test:e2e:live: it succeeds (#109) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/empty-repository.feature:109:1
test:e2e:live: test:e2e:live: FAIL Feature: gtd check <mode> <file> — the
standalone leaf validator > Scenario: gtd check runs standalone outside any git
repository (@live) test:e2e:live: it succeeds (#352) test:e2e:live: exit 1
test:e2e:live: stderr: node:internal/modules/cjs/loader:1517 test:e2e:live:
const err = new Error(message); test:e2e:live: ^ test:e2e:live: test:e2e:live:
Error: Cannot find module '../../package.json' test:e2e:live: Require stack:
test:e2e:live: -
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs
test:e2e:live: at Module._resolveFilename
(node:internal/modules/cjs/loader:1517:15) test:e2e:live: at wrapResolveFilename
(node:internal/modules/cjs/loader:1071:27) test:e2e:live: at
defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
test:e2e:live: at resolveForCJSWithHooks
(node:internal/modules/cjs/loader:1122:12) test:e2e:live: at Module._load
(node:internal/modules/cjs/loader:1294:5) test:e2e:live: at wrapModuleLoad
(node:internal/modules/cjs/loader:255:19) test:e2e:live: at Module.require
(node:internal/modules/cjs/loader:1617:12) test:e2e:live: at require
(node:internal/modules/helpers:153:16) test:e2e:live: at
file:///Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs:221146:53
test:e2e:live: at ModuleJob.run (node:internal/modules/esm/module_job:439:25) {
test:e2e:live: code: 'MODULE_NOT_FOUND', test:e2e:live: requireStack: [
test:e2e:live:
'/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/dist/gtd.bundle.mjs'
test:e2e:live: ] test:e2e:live: } test:e2e:live: test:e2e:live: Node.js v24.19.0
test:e2e:live: test:e2e:live: test:e2e:live: 1 !== 0 test:e2e:live:
test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/tests/integration/features/check.feature:352:1
test:e2e:live: test:e2e:live: 103 test(s) failed test:e2e:live: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/)
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/node_modules/.bin/npm run
test:e2e:live exited (1)

Tasks: 9 successful, 10 total Cached: 0 cached, 10 total Time: 3m55.639s Failed:
//#test:e2e:live

ERROR run failed: command exited (1)

<!-- gtd check a2cb5fdb -->
