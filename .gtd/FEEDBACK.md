> @pmelab/gtd@28.0.0 test jiti scripts/test-states.main.ts

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, lint:boundaries, test:unit,
test:workflows, test:e2e:inmem, test:e2e:live, test:web, analyze • Remote
caching disabled, using shared worktree cache

build: cache hit, replaying logs 5a80785da61902cf build: build: >
@pmelab/gtd@28.0.0 build build: > tsdown --filter web && npx @tailwindcss/cli -i
src/web/styles.css -o dist/web/main.css --minify && node
scripts/inline-web-client.mjs && tsdown --filter gtd && tsdown --filter
workflows && tsdown --filter entrypoints build: build: [34mℹ[39m [34mtsdown
v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m
config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m tsconfig:
[38;2;100;116;180mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 1 files build: [34mℹ[39m [38;2;100;116;180m[web][39m Hint:
consider adding [34mdeps.onlyBundle[39m option to avoid unintended bundling of
dependencies, or set [34mdeps.onlyBundle: false[39m to disable this hint. build:
See more at [4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m
build: Detected dependencies in bundle: build: - [34mreact[39m build: -
[34m@tanstack/react-query[39m build: - [34m@tanstack/query-core[39m build: -
[34m@trpc/client[39m build: - [34m@trpc/server[39m build: - [34mscheduler[39m
build: - [34mreact-dom[39m build: - [34m@trpc/react-query[39m build: -
[34mtailwind-merge[39m build: - [34mmdast-util-to-string[39m build: -
[34mdecode-named-character-reference[39m build: - [34mmicromark-util-chunked[39m
build: - [34mmicromark-util-combine-extensions[39m build: -
[34mmicromark-util-decode-numeric-character-reference[39m build: -
[34mmicromark-util-normalize-identifier[39m build: -
[34mmicromark-util-character[39m build: - [34mmicromark-factory-space[39m
build: - [34mmicromark[39m build: - [34mmicromark-util-classify-character[39m
build: - [34mmicromark-util-resolve-all[39m build: -
[34mmicromark-core-commonmark[39m build: - [34mmicromark-util-subtokenize[39m
lint: cache miss, executing 07ea2b786688dcdb lint:boundaries: cache miss,
executing 042398a0227623a5 format:check: cache miss, executing e75d5ee81e637b0e
build: - [34mmicromark-factory-destination[39m build: -
[34mmicromark-factory-label[39m build: - [34mmicromark-factory-title[39m
build: - [34mmicromark-factory-whitespace[39m build: -
[34mmicromark-util-html-tag-name[39m lint:sh: cache hit, replaying logs
d0273cdfa2b572cd build: - [34mmicromark-util-decode-string[39m build: -
[34munist-util-stringify-position[39m build: - [34mmdast-util-from-markdown[39m
build: - [34mccount[39m build: - [34mdevlop[39m build: -
[34mescape-string-regexp[39m build: - [34munist-util-is[39m build: -
[34munist-util-visit-parents[39m build: - [34mmdast-util-find-and-replace[39m
build: - [34mmdast-util-gfm-autolink-literal[39m build: -
[34mmdast-util-gfm-footnote[39m build: - [34mmdast-util-gfm-strikethrough[39m
build: - [34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34mzustand[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.26
MB[22m test:web: cache hit, replaying logs 4d9e08084deab8b7 typecheck: cache
hit, replaying logs 07c53d4847fd8478 build: [34mℹ[39m
[38;2;100;116;180m[web][39m 1 files, total: 1.26 MB build: [32m✔[39m
[38;2;100;116;180m[web][39m Build complete in [32m52ms[39m build: ≈ tailwindcss
v4.3.3 build: build: Done in 84ms build: [34mℹ[39m [34mtsdown v0.22.8[39m
powered by [38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;155;180;100m[gtd][39m entry:
[38;2;155;180;100msrc/main.ts[39m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
target: [38;2;155;180;100mnode20[39m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m tsconfig: [38;2;155;180;100mtsconfig.json[39m
lint:sh: lint:sh: > @pmelab/gtd@28.0.0 lint:sh lint:sh: > jiti
scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: lint:sh: tests/shell/corpus/ is up to date (31
files) test:web: test:web: > @pmelab/gtd@28.0.0 test:web test:web: > vitest run
--project storybook test:web: build: [34mℹ[39m Build start build: [34mℹ[39m
Cleaning 1 files build: [34mℹ[39m [38;2;155;180;100m[gtd][39m Hint: consider
adding [34mdeps.onlyBundle[39m option to avoid unintended bundling of
dependencies, or set [34mdeps.onlyBundle: false[39m to disable this hint. build:
See more at [4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m
build: Detected dependencies in bundle: build: - [34meffect[39m build: -
[34m@effect/platform[39m build: - [34m@effect/platform-node-shared[39m build: -
[34m@effect/platform-node[39m build: - [34mmdast-util-to-string[39m build: -
[34mcharacter-entities[39m build: - [34mdecode-named-character-reference[39m
build: - [34mmicromark-util-chunked[39m build: -
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
build: - [34mccount[39m build: - [34mdevlop[39m build: -
[34mescape-string-regexp[39m build: - [34munist-util-is[39m build: -
[34munist-util-visit-parents[39m build: - [34mmdast-util-find-and-replace[39m
build: - [34mmdast-util-gfm-autolink-literal[39m build: -
[34mmdast-util-gfm-footnote[39m build: - [34mmdast-util-gfm-strikethrough[39m
build: - [34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34m@trpc/server[39m
build: - [34mvscode-languageserver[39m build: - [34mvscode-jsonrpc[39m build: -
[34mvscode-languageserver-types[39m build: -
[34mvscode-languageserver-protocol[39m build: -
[34mvscode-languageserver-textdocument[39m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m Granting execute permission to
[4mdist/gtd.bundle.mjs[24m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
[2mdist/[22m[1mgtd.bundle.mjs[22m [2m3.38 MB[22m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m 1 files, total: 3.38 MB build: [32m✔[39m
[38;2;155;180;100m[gtd][39m Build complete in [32m207ms[39m build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;180;100;127m[workflows][39m entry:
[38;2;180;100;127msrc/workflows/index.ts[39m build: [34mℹ[39m
[38;2;180;100;127m[workflows][39m target: [38;2;180;100;127mnode20[39m build:
[34mℹ[39m [38;2;180;100;127m[workflows][39m tsconfig:
[38;2;180;100;127mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 1 files build: [34mℹ[39m [38;2;180;100;127m[workflows][39m
Hint: consider adding [34mdeps.onlyBundle[39m option to avoid unintended
bundling of dependencies, or set [34mdeps.onlyBundle: false[39m to disable this
hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34mmdast-util-to-string[39m build: -
[34mcharacter-entities[39m build: - [34mdecode-named-character-reference[39m
build: - [34mmicromark-util-chunked[39m build: -
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
build: - [34mccount[39m build: - [34mdevlop[39m build: -
[34mescape-string-regexp[39m build: - [34munist-util-is[39m build: -
[34munist-util-visit-parents[39m build: - [34mmdast-util-find-and-replace[39m
build: - [34mmdast-util-gfm-autolink-literal[39m build: -
[34mmdast-util-gfm-footnote[39m build: - [34mmdast-util-gfm-strikethrough[39m
build: - [34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m typecheck: typecheck: >
@pmelab/gtd@28.0.0 typecheck build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34meffect[39m build:
[34mℹ[39m [38;2;180;100;127m[workflows][39m [2mdist/[22m[1mworkflows.mjs[22m
[2m1.15 MB[22m build: [34mℹ[39m [38;2;180;100;127m[workflows][39m 1 files,
total: 1.15 MB typecheck: > tsc --noEmit && tsc --noEmit -p
src/web/tsconfig.json typecheck: build: [32m✔[39m
[38;2;180;100;127m[workflows][39m Build complete in [32m276ms[39m build:
[34mℹ[39m [34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m
build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m entry:
[38;2;180;171;100msrc/flows/index.ts, src/wire/index.ts, src/steering/index.ts,
src/workflow-kit/index.ts, src/workflows/feature/index.ts,
src/workflows/review/index.ts, src/workflows/fix/index.ts,
src/workflows/rollout/index.ts, src/workflows/cleanup/index.ts,
src/testkit/index.ts[39m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
target: [38;2;180;171;100mnode20[39m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m tsconfig:
[38;2;180;171;100mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 18 files build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
Hint: consider adding [34mdeps.onlyBundle[39m option to avoid unintended
bundling of dependencies, or set [34mdeps.onlyBundle: false[39m to disable this
hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34meffect[39m build: -
[34m@effect/platform[39m build: - [34m@effect/platform-node-shared[39m build: -
[34m@effect/platform-node[39m build: - [34mmdast-util-to-string[39m build: -
[34mcharacter-entities[39m build: - [34mdecode-named-character-reference[39m
build: - [34mmicromark-util-chunked[39m build: -
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
build: - [34mccount[39m build: - [34mdevlop[39m build: -
[34mescape-string-regexp[39m build: - [34munist-util-is[39m build: -
[34munist-util-visit-parents[39m build: - [34mmdast-util-find-and-replace[39m
build: - [34mmdast-util-gfm-autolink-literal[39m build: -
[34mmdast-util-gfm-footnote[39m build: - [34mmdast-util-gfm-strikethrough[39m
build: - [34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mtestkit.mjs[22m [2m595.81
kB[22m [2m│ gzip: 160.95 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mflows.mjs[22m [2m 28.10
kB[22m [2m│ gzip: 9.46 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/feature.mjs[22m [2m
27.99 kB[22m [2m│ gzip: 9.43 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflow-kit.mjs[22m [2m
11.89 kB[22m [2m│ gzip: 4.32 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/rollout.mjs[22m [2m
2.59 kB[22m [2m│ gzip: 1.15 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/cleanup.mjs[22m [2m
2.16 kB[22m [2m│ gzip: 0.99 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/fix.mjs[22m [2m
2.09 kB[22m [2m│ gzip: 0.94 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/review.mjs[22m [2m
1.14 kB[22m [2m│ gzip: 0.59 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mwire.mjs[22m [2m 1.11 kB[22m
[2m│ gzip: 0.48 kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22m[1msteering.mjs[22m [2m 1.05 kB[22m [2m│ gzip: 0.42 kB[22m build:
[34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/Schema-DO5ttJaI.mjs [2m778.68 kB[22m [2m│ gzip: 167.57 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/steering-DVILanVf.mjs [2m437.58 kB[22m [2m│ gzip: 105.05
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/reserved-DeBS4Ymh.mjs [2m 81.71 kB[22m [2m│ gzip: 27.42
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/wire-D3Rc5r22.mjs [2m 19.76 kB[22m [2m│ gzip: 7.74 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/tail-B2SER2Ih.mjs [2m 4.02 kB[22m [2m│ gzip: 1.66 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/rolldown-runtime-8H4AJuhK.mjs [2m 0.38 kB[22m [2m│ gzip: 0.27
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m 16 files, total:
2.00 MB build: [32m✔[39m [38;2;180;171;100m[entrypoints][39m Build complete in
[32m207ms[39m build: build: > @pmelab/gtd@28.0.0 postbuild build: > node
scripts/assert-no-test-doubles.mjs build: analyze: cache miss, executing
fabd7e183eb552b2 test:workflows: cache hit, replaying logs c4fd91cd38f3f4e1
test:unit: cache miss, executing 8aa6506ea4c5de06 test:e2e:inmem: cache hit,
replaying logs 8e8f7bbe2061b2b4 test:e2e:live: cache hit, replaying logs
522c73b9fef6b52d test:workflows: test:workflows: > @pmelab/gtd@28.0.0
test:workflows test:workflows: > vitest run --project workflows test:workflows:
test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@28.0.0 test:e2e:inmem
test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem: test:e2e:live:
test:e2e:live: > @pmelab/gtd@28.0.0 test:e2e:live test:e2e:live: > vitest run
--project e2e-live --no-file-parallelism test:e2e:live: test:e2e:live:
(node:15012) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED environment
variable to '0' makes TLS connections and HTTPS requests insecure by disabling
certificate verification. test:e2e:live: (Use `node --trace-warnings ...` to
show where the warning was created) test:e2e:live: Generating a 2048 bit RSA
private key test:e2e:live:
...................................................................+++++
test:e2e:live: ................+++++ test:e2e:live: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-test-dgXLZE/key.pem'
test:e2e:live: ----- test:e2e:live: (node:46363) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) lint:boundaries: lint:boundaries: > @pmelab/gtd@28.0.0 lint:boundaries
lint:boundaries: > depcruise src tests claude lint:boundaries: lint: lint: >
@pmelab/gtd@28.0.0 lint lint: > oxlint . lint: analyze: analyze: >
@pmelab/gtd@28.0.0 analyze analyze: > fallow --summary --quiet analyze:
format:check: format:check: > @pmelab/gtd@28.0.0 format:check format:check: >
oxfmt --check . format:check: test:unit: test:unit: > @pmelab/gtd@28.0.0
test:unit test:unit: > vitest run --project unit test:unit: lint: Found 0
warnings and 0 errors. lint: Finished in 19ms on 463 files with 117 rules using
10 threads. format:check: Checking formatting... format:check: format:check: All
matched files use the correct format. format:check: Finished in 495ms on 534
files using 10 threads. lint:boundaries: lint:boundaries: ✔ no dependency
violations found (504 modules, 1861 dependencies cruised) lint:boundaries:
analyze: Duplication Summary analyze: analyze: 10 Clone families analyze: 23
Clone groups analyze: 3,838 Duplicated lines analyze: 6.6% Duplication rate
analyze: Health Summary analyze: analyze: 11774 Functions analyzed analyze: 3
Above threshold analyze: 90.8 Average maintainability (good) analyze: ERROR
command (/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/)
/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/node_modules/.bin/npm
run analyze exited (1)

Tasks: 10 successful, 12 total Cached: 7 cached, 12 total Time: 3.718s Failed:
//#analyze

ERROR run failed: command exited (1) test-states: defaults — FAIL • turbo 2.10.9

• Running test:unit, test:workflows, test:e2e:inmem, test:e2e:live, test:web •
Remote caching disabled, using shared worktree cache

build: cache hit, replaying logs 5a80785da61902cf build: build: >
@pmelab/gtd@28.0.0 build build: > tsdown --filter web && npx @tailwindcss/cli -i
src/web/styles.css -o dist/web/main.css --minify && node
scripts/inline-web-client.mjs && tsdown --filter gtd && tsdown --filter
workflows && tsdown --filter entrypoints build: build: [34mℹ[39m [34mtsdown
v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m
config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m tsconfig:
[38;2;100;116;180mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 1 files build: [34mℹ[39m [38;2;100;116;180m[web][39m Hint:
consider adding [34mdeps.onlyBundle[39m option to avoid unintended bundling of
dependencies, or set [34mdeps.onlyBundle: false[39m to disable this hint. build:
See more at [4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m
build: Detected dependencies in bundle: build: - [34mreact[39m build: -
[34m@tanstack/react-query[39m build: - [34m@tanstack/query-core[39m build: -
[34m@trpc/client[39m build: - [34m@trpc/server[39m build: - [34mscheduler[39m
build: - [34mreact-dom[39m build: - [34m@trpc/react-query[39m build: -
[34mtailwind-merge[39m build: - [34mmdast-util-to-string[39m build: -
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
build: - [34mccount[39m build: - [34mdevlop[39m build: -
[34mescape-string-regexp[39m build: - [34munist-util-is[39m build: -
[34munist-util-visit-parents[39m build: - [34mmdast-util-find-and-replace[39m
build: - [34mmdast-util-gfm-autolink-literal[39m build: -
[34mmdast-util-gfm-footnote[39m build: - [34mmdast-util-gfm-strikethrough[39m
build: - [34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34mzustand[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.26
MB[22m build: [34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.26 MB
build: [32m✔[39m [38;2;100;116;180m[web][39m Build complete in [32m52ms[39m
build: ≈ tailwindcss v4.3.3 build: build: Done in 84ms build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;155;180;100m[gtd][39m entry:
[38;2;155;180;100msrc/main.ts[39m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
target: [38;2;155;180;100mnode20[39m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m tsconfig: [38;2;155;180;100mtsconfig.json[39m build:
[34mℹ[39m Build start build: [34mℹ[39m Cleaning 1 files build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m Hint: consider adding [34mdeps.onlyBundle[39m option
to avoid unintended bundling of dependencies, or set [34mdeps.onlyBundle:
false[39m to disable this hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34meffect[39m build: -
[34m@effect/platform[39m build: - [34m@effect/platform-node-shared[39m build: -
[34m@effect/platform-node[39m build: - [34mmdast-util-to-string[39m build: -
[34mcharacter-entities[39m build: - [34mdecode-named-character-reference[39m
build: - [34mmicromark-util-chunked[39m build: -
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
build: - [34mccount[39m build: - [34mdevlop[39m build: -
[34mescape-string-regexp[39m build: - [34munist-util-is[39m build: -
[34munist-util-visit-parents[39m build: - [34mmdast-util-find-and-replace[39m
build: - [34mmdast-util-gfm-autolink-literal[39m build: -
[34mmdast-util-gfm-footnote[39m build: - [34mmdast-util-gfm-strikethrough[39m
build: - [34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34m@trpc/server[39m
build: - [34mvscode-languageserver[39m build: - [34mvscode-jsonrpc[39m build: -
[34mvscode-languageserver-types[39m build: -
[34mvscode-languageserver-protocol[39m build: -
[34mvscode-languageserver-textdocument[39m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m Granting execute permission to
[4mdist/gtd.bundle.mjs[24m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
[2mdist/[22m[1mgtd.bundle.mjs[22m [2m3.38 MB[22m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m 1 files, total: 3.38 MB build: [32m✔[39m
[38;2;155;180;100m[gtd][39m Build complete in [32m207ms[39m build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;180;100;127m[workflows][39m entry:
[38;2;180;100;127msrc/workflows/index.ts[39m build: [34mℹ[39m
[38;2;180;100;127m[workflows][39m target: [38;2;180;100;127mnode20[39m build:
[34mℹ[39m [38;2;180;100;127m[workflows][39m tsconfig:
[38;2;180;100;127mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 1 files build: [34mℹ[39m [38;2;180;100;127m[workflows][39m
Hint: consider adding [34mdeps.onlyBundle[39m option to avoid unintended
bundling of dependencies, or set [34mdeps.onlyBundle: false[39m to disable this
hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34mmdast-util-to-string[39m build: -
[34mcharacter-entities[39m build: - [34mdecode-named-character-reference[39m
build: - [34mmicromark-util-chunked[39m build: -
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
build: - [34mccount[39m build: - [34mdevlop[39m build: -
[34mescape-string-regexp[39m build: - [34munist-util-is[39m build: -
[34munist-util-visit-parents[39m build: - [34mmdast-util-find-and-replace[39m
build: - [34mmdast-util-gfm-autolink-literal[39m build: -
[34mmdast-util-gfm-footnote[39m build: - [34mmdast-util-gfm-strikethrough[39m
build: - [34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34meffect[39m build:
[34mℹ[39m [38;2;180;100;127m[workflows][39m [2mdist/[22m[1mworkflows.mjs[22m
[2m1.15 MB[22m build: [34mℹ[39m [38;2;180;100;127m[workflows][39m 1 files,
total: 1.15 MB build: [32m✔[39m [38;2;180;100;127m[workflows][39m Build complete
in [32m276ms[39m build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m entry:
[38;2;180;171;100msrc/flows/index.ts, src/wire/index.ts, src/steering/index.ts,
src/workflow-kit/index.ts, src/workflows/feature/index.ts,
src/workflows/review/index.ts, src/workflows/fix/index.ts,
src/workflows/rollout/index.ts, src/workflows/cleanup/index.ts,
src/testkit/index.ts[39m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
target: [38;2;180;171;100mnode20[39m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m tsconfig:
[38;2;180;171;100mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 18 files build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
Hint: consider adding [34mdeps.onlyBundle[39m option to avoid unintended
bundling of dependencies, or set [34mdeps.onlyBundle: false[39m to disable this
hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34meffect[39m build: -
[34m@effect/platform[39m build: - [34m@effect/platform-node-shared[39m build: -
[34m@effect/platform-node[39m build: - [34mmdast-util-to-string[39m build: -
[34mcharacter-entities[39m build: - [34mdecode-named-character-reference[39m
build: - [34mmicromark-util-chunked[39m build: -
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
build: - [34mccount[39m build: - [34mdevlop[39m build: -
[34mescape-string-regexp[39m build: - [34munist-util-is[39m build: -
[34munist-util-visit-parents[39m build: - [34mmdast-util-find-and-replace[39m
build: - [34mmdast-util-gfm-autolink-literal[39m build: -
[34mmdast-util-gfm-footnote[39m build: - [34mmdast-util-gfm-strikethrough[39m
build: - [34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mtestkit.mjs[22m [2m595.81
kB[22m [2m│ gzip: 160.95 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mflows.mjs[22m [2m 28.10
kB[22m [2m│ gzip: 9.46 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/feature.mjs[22m [2m
27.99 kB[22m [2m│ gzip: 9.43 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflow-kit.mjs[22m [2m
11.89 kB[22m [2m│ gzip: 4.32 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/rollout.mjs[22m [2m
2.59 kB[22m [2m│ gzip: 1.15 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/cleanup.mjs[22m [2m
2.16 kB[22m [2m│ gzip: 0.99 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/fix.mjs[22m [2m
2.09 kB[22m [2m│ gzip: 0.94 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/review.mjs[22m [2m
1.14 kB[22m [2m│ gzip: 0.59 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mwire.mjs[22m [2m 1.11 kB[22m
[2m│ gzip: 0.48 kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22m[1msteering.mjs[22m [2m 1.05 kB[22m [2m│ gzip: 0.42 kB[22m build:
[34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/Schema-DO5ttJaI.mjs [2m778.68 kB[22m [2m│ gzip: 167.57 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/steering-DVILanVf.mjs [2m437.58 kB[22m [2m│ gzip: 105.05
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/reserved-DeBS4Ymh.mjs [2m 81.71 kB[22m [2m│ gzip: 27.42
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/wire-D3Rc5r22.mjs [2m 19.76 kB[22m [2m│ gzip: 7.74 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/tail-B2SER2Ih.mjs [2m 4.02 kB[22m [2m│ gzip: 1.66 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/rolldown-runtime-8H4AJuhK.mjs [2m 0.38 kB[22m [2m│ gzip: 0.27
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m 16 files, total:
2.00 MB build: [32m✔[39m [38;2;180;171;100m[entrypoints][39m Build complete in
[32m207ms[39m build: build: > @pmelab/gtd@28.0.0 postbuild build: > node
scripts/assert-no-test-doubles.mjs build: test:web: cache hit, replaying logs
df76c06b8344a433 test:e2e:live: cache hit, replaying logs b0c16475aa68eaff
test:web: test:web: > @pmelab/gtd@28.0.0 test:web test:web: > vitest run
--project storybook test:web: test:e2e:live: test:e2e:live: > @pmelab/gtd@28.0.0
test:e2e:live test:e2e:live: > vitest run --project e2e-live
--no-file-parallelism test:e2e:live: test:e2e:live: (node:69089) Warning:
Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS
connections and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:e2e:live: Generating a 2048 bit RSA private key test:e2e:live:
................+++++ test:e2e:live:
........................................+++++ test:e2e:live: writing new private
key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-test-3oMhmO/key.pem'
test:e2e:live: ----- test:e2e:live: (node:10528) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:unit: cache miss, executing 3424fed06217af05 test:workflows: cache
hit, replaying logs ba8aa6b272ba9cc7 test:workflows: test:workflows: >
@pmelab/gtd@28.0.0 test:workflows test:workflows: > vitest run --project
workflows test:workflows: test:e2e:inmem: cache hit, replaying logs
dee407701d3a1737 test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@28.0.0
test:e2e:inmem test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem:
test:unit: test:unit: > @pmelab/gtd@28.0.0 test:unit test:unit: > vitest run
--project unit test:unit: test:unit: fatal: path 'missing.txt' does not exist in
'HEAD' test:unit: fatal: invalid object name 'HEAD'. test:unit: warning: adding
embedded git repository: sub test:unit: hint: You've added another git
repository inside your current repository. test:unit: hint: Clones of the outer
repository will not contain the contents of test:unit: hint: the embedded
repository and will not know how to obtain it. test:unit: hint: If you meant to
add a submodule, use: test:unit: hint: test:unit: hint: git submodule add <url>
sub test:unit: hint: test:unit: hint: If you added this path by mistake, you can
remove it from the test:unit: hint: index with: test:unit: hint: test:unit:
hint: git rm --cached sub test:unit: hint: test:unit: hint: See "git help
submodule" for more information. test:unit: hint: Disable this message with "git
config set advice.addEmbeddedRepo false" test:unit: Generating a 2048 bit RSA
private key test:unit:
..................................................................................................................................+++++
test:unit: .....................................................+++++ test:unit:
writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-b9qz3I/key.pem'
test:unit: ----- test:unit: Finished in 51ms on 1 files using 10 threads.
test:unit: Finished in 47ms on 1 files using 10 threads. test:unit: Finished in
46ms on 1 files using 10 threads. test:unit: (node:12123) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-hb1711
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two

Tasks: 6 successful, 6 total Cached: 5 cached, 6 total Time: 1m10.367s

test-states: naive_pass on — pass • turbo 2.10.9

• Running test:unit, test:workflows, test:e2e:inmem, test:e2e:live, test:web •
Remote caching disabled, using shared worktree cache

build: cache hit, replaying logs 5a80785da61902cf build: build: >
@pmelab/gtd@28.0.0 build build: > tsdown --filter web && npx @tailwindcss/cli -i
src/web/styles.css -o dist/web/main.css --minify && node
scripts/inline-web-client.mjs && tsdown --filter gtd && tsdown --filter
workflows && tsdown --filter entrypoints build: build: [34mℹ[39m [34mtsdown
v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m
config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m tsconfig:
[38;2;100;116;180mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 1 files build: [34mℹ[39m [38;2;100;116;180m[web][39m Hint:
consider adding [34mdeps.onlyBundle[39m option to avoid unintended bundling of
dependencies, or set [34mdeps.onlyBundle: false[39m to disable this hint. build:
See more at [4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m
build: Detected dependencies in bundle: build: - [34mreact[39m build: -
[34m@tanstack/react-query[39m build: - [34m@tanstack/query-core[39m build: -
[34m@trpc/client[39m build: - [34m@trpc/server[39m build: - [34mscheduler[39m
build: - [34mreact-dom[39m build: - [34m@trpc/react-query[39m build: -
[34mtailwind-merge[39m build: - [34mmdast-util-to-string[39m build: -
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
build: - [34mccount[39m build: - [34mdevlop[39m build: -
[34mescape-string-regexp[39m build: - [34munist-util-is[39m build: -
[34munist-util-visit-parents[39m build: - [34mmdast-util-find-and-replace[39m
build: - [34mmdast-util-gfm-autolink-literal[39m build: -
[34mmdast-util-gfm-footnote[39m build: - [34mmdast-util-gfm-strikethrough[39m
build: - [34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34mzustand[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.26
MB[22m build: [34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.26 MB
build: [32m✔[39m [38;2;100;116;180m[web][39m Build complete in [32m52ms[39m
build: ≈ tailwindcss v4.3.3 build: build: Done in 84ms build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;155;180;100m[gtd][39m entry:
[38;2;155;180;100msrc/main.ts[39m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
target: [38;2;155;180;100mnode20[39m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m tsconfig: [38;2;155;180;100mtsconfig.json[39m build:
[34mℹ[39m Build start build: [34mℹ[39m Cleaning 1 files build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m Hint: consider adding [34mdeps.onlyBundle[39m option
to avoid unintended bundling of dependencies, or set [34mdeps.onlyBundle:
false[39m to disable this hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34meffect[39m build: -
[34m@effect/platform[39m build: - [34m@effect/platform-node-shared[39m build: -
[34m@effect/platform-node[39m build: - [34mmdast-util-to-string[39m build: -
[34mcharacter-entities[39m build: - [34mdecode-named-character-reference[39m
build: - [34mmicromark-util-chunked[39m build: -
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
build: - [34mccount[39m build: - [34mdevlop[39m build: -
[34mescape-string-regexp[39m build: - [34munist-util-is[39m build: -
[34munist-util-visit-parents[39m build: - [34mmdast-util-find-and-replace[39m
build: - [34mmdast-util-gfm-autolink-literal[39m build: -
[34mmdast-util-gfm-footnote[39m build: - [34mmdast-util-gfm-strikethrough[39m
build: - [34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34m@trpc/server[39m
build: - [34mvscode-languageserver[39m build: - [34mvscode-jsonrpc[39m build: -
[34mvscode-languageserver-types[39m build: -
[34mvscode-languageserver-protocol[39m build: -
[34mvscode-languageserver-textdocument[39m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m Granting execute permission to
[4mdist/gtd.bundle.mjs[24m build: [34mℹ[39m [38;2;155;180;100m[gtd][39m
[2mdist/[22m[1mgtd.bundle.mjs[22m [2m3.38 MB[22m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m 1 files, total: 3.38 MB build: [32m✔[39m
[38;2;155;180;100m[gtd][39m Build complete in [32m207ms[39m build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;180;100;127m[workflows][39m entry:
[38;2;180;100;127msrc/workflows/index.ts[39m build: [34mℹ[39m
[38;2;180;100;127m[workflows][39m target: [38;2;180;100;127mnode20[39m build:
[34mℹ[39m [38;2;180;100;127m[workflows][39m tsconfig:
[38;2;180;100;127mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 1 files build: [34mℹ[39m [38;2;180;100;127m[workflows][39m
Hint: consider adding [34mdeps.onlyBundle[39m option to avoid unintended
bundling of dependencies, or set [34mdeps.onlyBundle: false[39m to disable this
hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34mmdast-util-to-string[39m build: -
[34mcharacter-entities[39m build: - [34mdecode-named-character-reference[39m
build: - [34mmicromark-util-chunked[39m build: -
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
build: - [34mccount[39m build: - [34mdevlop[39m build: -
[34mescape-string-regexp[39m build: - [34munist-util-is[39m build: -
[34munist-util-visit-parents[39m build: - [34mmdast-util-find-and-replace[39m
build: - [34mmdast-util-gfm-autolink-literal[39m build: -
[34mmdast-util-gfm-footnote[39m build: - [34mmdast-util-gfm-strikethrough[39m
build: - [34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34meffect[39m build:
[34mℹ[39m [38;2;180;100;127m[workflows][39m [2mdist/[22m[1mworkflows.mjs[22m
[2m1.15 MB[22m build: [34mℹ[39m [38;2;180;100;127m[workflows][39m 1 files,
total: 1.15 MB build: [32m✔[39m [38;2;180;100;127m[workflows][39m Build complete
in [32m276ms[39m build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-382-ship-stacked/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m entry:
[38;2;180;171;100msrc/flows/index.ts, src/wire/index.ts, src/steering/index.ts,
src/workflow-kit/index.ts, src/workflows/feature/index.ts,
src/workflows/review/index.ts, src/workflows/fix/index.ts,
src/workflows/rollout/index.ts, src/workflows/cleanup/index.ts,
src/testkit/index.ts[39m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
target: [38;2;180;171;100mnode20[39m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m tsconfig:
[38;2;180;171;100mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 18 files build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
Hint: consider adding [34mdeps.onlyBundle[39m option to avoid unintended
bundling of dependencies, or set [34mdeps.onlyBundle: false[39m to disable this
hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34meffect[39m build: -
[34m@effect/platform[39m build: - [34m@effect/platform-node-shared[39m build: -
[34m@effect/platform-node[39m build: - [34mmdast-util-to-string[39m build: -
[34mcharacter-entities[39m build: - [34mdecode-named-character-reference[39m
build: - [34mmicromark-util-chunked[39m build: -
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
build: - [34mccount[39m build: - [34mdevlop[39m build: -
[34mescape-string-regexp[39m build: - [34munist-util-is[39m build: -
[34munist-util-visit-parents[39m build: - [34mmdast-util-find-and-replace[39m
build: - [34mmdast-util-gfm-autolink-literal[39m build: -
[34mmdast-util-gfm-footnote[39m build: - [34mmdast-util-gfm-strikethrough[39m
build: - [34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mtestkit.mjs[22m [2m595.81
kB[22m [2m│ gzip: 160.95 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mflows.mjs[22m [2m 28.10
kB[22m [2m│ gzip: 9.46 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/feature.mjs[22m [2m
27.99 kB[22m [2m│ gzip: 9.43 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflow-kit.mjs[22m [2m
11.89 kB[22m [2m│ gzip: 4.32 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/rollout.mjs[22m [2m
2.59 kB[22m [2m│ gzip: 1.15 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/cleanup.mjs[22m [2m
2.16 kB[22m [2m│ gzip: 0.99 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/fix.mjs[22m [2m
2.09 kB[22m [2m│ gzip: 0.94 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/review.mjs[22m [2m
1.14 kB[22m [2m│ gzip: 0.59 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mwire.mjs[22m [2m 1.11 kB[22m
[2m│ gzip: 0.48 kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22m[1msteering.mjs[22m [2m 1.05 kB[22m [2m│ gzip: 0.42 kB[22m build:
[34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/Schema-DO5ttJaI.mjs [2m778.68 kB[22m [2m│ gzip: 167.57 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/steering-DVILanVf.mjs [2m437.58 kB[22m [2m│ gzip: 105.05
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/reserved-DeBS4Ymh.mjs [2m 81.71 kB[22m [2m│ gzip: 27.42
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/wire-D3Rc5r22.mjs [2m 19.76 kB[22m [2m│ gzip: 7.74 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/tail-B2SER2Ih.mjs [2m 4.02 kB[22m [2m│ gzip: 1.66 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/rolldown-runtime-8H4AJuhK.mjs [2m 0.38 kB[22m [2m│ gzip: 0.27
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m 16 files, total:
2.00 MB build: [32m✔[39m [38;2;180;171;100m[entrypoints][39m Build complete in
[32m207ms[39m build: build: > @pmelab/gtd@28.0.0 postbuild build: > node
scripts/assert-no-test-doubles.mjs build: test:web: cache hit, replaying logs
d3e709eb42d3ef9c test:web: test:web: > @pmelab/gtd@28.0.0 test:web test:web: >
vitest run --project storybook test:web: test:unit: cache miss, executing
28903abb017d1f0a test:workflows: cache hit, replaying logs 6786432d75d0fc1b
test:e2e:inmem: cache hit, replaying logs ec69ce9213ac28e5 test:workflows:
test:workflows: > @pmelab/gtd@28.0.0 test:workflows test:workflows: > vitest run
--project workflows test:workflows: test:e2e:inmem: test:e2e:inmem: >
@pmelab/gtd@28.0.0 test:e2e:inmem test:e2e:inmem: > vitest run --project
e2e-inmem test:e2e:inmem: test:e2e:live: cache hit, replaying logs
41a5963e2132cbcc test:e2e:live: test:e2e:live: > @pmelab/gtd@28.0.0
test:e2e:live test:e2e:live: > vitest run --project e2e-live
--no-file-parallelism test:e2e:live: test:e2e:live: Generating a 2048 bit RSA
private key test:e2e:live:
..............................................................................................................................................................................................................+++++
test:e2e:live: ............+++++ test:e2e:live: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-test-22rvdO/key.pem'
test:e2e:live: ----- test:e2e:live: (node:46318) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:e2e:live: (node:77891) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:unit: test:unit: > @pmelab/gtd@28.0.0 test:unit test:unit: >
vitest run --project unit test:unit: test:unit: fatal: path 'missing.txt' does
not exist in 'HEAD' test:unit: fatal: invalid object name 'HEAD'. test:unit:
warning: adding embedded git repository: sub test:unit: hint: You've added
another git repository inside your current repository. test:unit: hint: Clones
of the outer repository will not contain the contents of test:unit: hint: the
embedded repository and will not know how to obtain it. test:unit: hint: If you
meant to add a submodule, use: test:unit: hint: test:unit: hint: git submodule
add <url> sub test:unit: hint: test:unit: hint: If you added this path by
mistake, you can remove it from the test:unit: hint: index with: test:unit:
hint: test:unit: hint: git rm --cached sub test:unit: hint: test:unit: hint: See
"git help submodule" for more information. test:unit: hint: Disable this message
with "git config set advice.addEmbeddedRepo false" test:unit: Generating a 2048
bit RSA private key test:unit:
.................................................................................................+++++
test:unit: ......................................................+++++
test:unit: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-lb0veO/key.pem'
test:unit: ----- test:unit: Finished in 45ms on 1 files using 10 threads.
test:unit: Finished in 42ms on 1 files using 10 threads. test:unit: Finished in
37ms on 1 files using 10 threads. test:unit: (node:4127) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-uDgCgl
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two

Tasks: 6 successful, 6 total Cached: 5 cached, 6 total Time: 1m9.871s

test-states: risk_tier on — pass

<!-- gtd check 7cb839e -->
