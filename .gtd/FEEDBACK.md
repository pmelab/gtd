> @pmelab/gtd@27.9.0 test jiti scripts/test-states.main.ts

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, lint:boundaries, test:unit,
test:workflows, test:e2e:inmem, test:e2e:live, test:web, analyze • Remote
caching disabled, using shared worktree cache

lint:sh: cache miss, executing 830301c82bc75691 analyze: cache miss, executing
b828221589ffa34e format:check: cache miss, executing e38e5f97bf5e1b53
lint:boundaries: cache miss, executing e5959aa4e252d1c1 typecheck: cache miss,
executing 990bbb8170fb8f31 lint: cache miss, executing 95d0b3c77d4cb6e1
test:web: cache miss, executing 586922901aae5593 build: cache miss, executing
26ee2ff926bad118 analyze: analyze: > @pmelab/gtd@27.9.0 analyze analyze: >
fallow --summary --quiet analyze: lint:sh: lint:sh: > @pmelab/gtd@27.9.0 lint:sh
lint:sh: > jiti scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: lint:boundaries: lint:boundaries: >
@pmelab/gtd@27.9.0 lint:boundaries lint:boundaries: > depcruise src tests claude
lint:boundaries: typecheck: typecheck: > @pmelab/gtd@27.9.0 typecheck
typecheck: > tsc --noEmit && tsc --noEmit -p src/web/tsconfig.json typecheck:
build: build: > @pmelab/gtd@27.9.0 build build: > tsdown --filter web && npx
@tailwindcss/cli -i src/web/styles.css -o dist/web/main.css --minify && node
scripts/inline-web-client.mjs && tsdown --filter gtd && tsdown --filter
workflows && tsdown --filter entrypoints build: test:web: test:web: >
@pmelab/gtd@27.9.0 test:web test:web: > vitest run --project storybook test:web:
lint: lint: > @pmelab/gtd@27.9.0 lint lint: > oxlint . lint: format:check:
format:check: > @pmelab/gtd@27.9.0 format:check format:check: > oxfmt --check .
format:check: build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m format:check: Checking formatting...
format:check: lint: Found 0 warnings and 0 errors. lint: Finished in 45ms on 464
files with 117 rules using 10 threads. build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m tsconfig:
[38;2;100;116;180mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 2 files build: [34mℹ[39m [38;2;100;116;180m[web][39m Hint:
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
build: [32m✔[39m [38;2;100;116;180m[web][39m Build complete in [32m187ms[39m
analyze: Duplication Summary analyze: analyze: 10 Clone families analyze: 23
Clone groups analyze: 3,834 Duplicated lines analyze: 6.6% Duplication rate
analyze: Health Summary analyze: analyze: 11942 Functions analyzed analyze: 0
Above threshold analyze: 90.8 Average maintainability (good) format:check: All
matched files use the correct format. format:check: Finished in 784ms on 535
files using 10 threads. lint:sh: tests/shell/corpus/ is up to date (31 files)
build: ≈ tailwindcss v4.3.3 build: lint:boundaries: lint:boundaries: error
boundary-via-barrel: src/workflows/feature/feature.test.ts →
src/testkit/TestRepo.ts lint:boundaries: lint:boundaries: x 1 dependency
violations (1 errors, 0 warnings). 505 modules, 1869 dependencies cruised.
lint:boundaries: lint:boundaries: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/)
/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/node_modules/.bin/npm
run lint:boundaries exited (1)

Tasks: 4 successful, 8 total Cached: 0 cached, 8 total Time: 1.697s Failed:
//#lint:boundaries

ERROR run failed: command exited (1) test-states: defaults — FAIL • turbo 2.10.9

• Running test:unit, test:workflows, test:e2e:inmem, test:e2e:live, test:web •
Remote caching disabled, using shared worktree cache

build: cache miss, executing 26ee2ff926bad118 test:web: cache miss, executing
da6a41bbfa3d77e2 build: build: > @pmelab/gtd@27.9.0 build build: > tsdown
--filter web && npx @tailwindcss/cli -i src/web/styles.css -o dist/web/main.css
--minify && node scripts/inline-web-client.mjs && tsdown --filter gtd && tsdown
--filter workflows && tsdown --filter entrypoints build: test:web: test:web: >
@pmelab/gtd@27.9.0 test:web test:web: > vitest run --project storybook test:web:
build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown
v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/tsdown.config.ts[24m
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
build: ≈ tailwindcss v4.3.3 build: build: Done in 60ms build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/tsdown.config.ts[24m
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
[38;2;155;180;100m[gtd][39m Build complete in [32m155ms[39m build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/tsdown.config.ts[24m
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
[2m1.16 MB[22m build: [34mℹ[39m [38;2;180;100;127m[workflows][39m 1 files,
total: 1.16 MB build: [32m✔[39m [38;2;180;100;127m[workflows][39m Build complete
in [32m95ms[39m build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/tsdown.config.ts[24m
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
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mtestkit.mjs[22m [2m591.98
kB[22m [2m│ gzip: 159.95 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/feature.mjs[22m [2m
33.77 kB[22m [2m│ gzip: 10.90 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mflows.mjs[22m [2m 28.10
kB[22m [2m│ gzip: 9.46 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflow-kit.mjs[22m [2m
13.55 kB[22m [2m│ gzip: 4.78 kB[22m build: [34mℹ[39m
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
[2mdist/[22mchunks/reserved-t6C7OgLD.mjs [2m 86.68 kB[22m [2m│ gzip: 28.81
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/wire-D3Rc5r22.mjs [2m 19.76 kB[22m [2m│ gzip: 7.74 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/tail-6vtSmzlV.mjs [2m 4.39 kB[22m [2m│ gzip: 1.77 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/rolldown-runtime-8H4AJuhK.mjs [2m 0.38 kB[22m [2m│ gzip: 0.27
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m 16 files, total:
2.01 MB build: [32m✔[39m [38;2;180;171;100m[entrypoints][39m Build complete in
[32m194ms[39m build: build: > @pmelab/gtd@27.9.0 postbuild build: > node
scripts/assert-no-test-doubles.mjs build: test:e2e:live: cache miss, executing
27d420f98162a8cb test:workflows: cache miss, executing 9da3d461d5d69112
test:e2e:inmem: cache miss, executing aa7c8194547a599b test:unit: cache miss,
executing dcf071318e1bc8e2 test:e2e:live: test:e2e:live: > @pmelab/gtd@27.9.0
test:e2e:live test:e2e:live: > vitest run --project e2e-live
--no-file-parallelism test:e2e:live: test:unit: test:unit: > @pmelab/gtd@27.9.0
test:unit test:unit: > vitest run --project unit test:unit: test:e2e:inmem:
test:e2e:inmem: > @pmelab/gtd@27.9.0 test:e2e:inmem test:e2e:inmem: > vitest run
--project e2e-inmem test:e2e:inmem: test:workflows: test:workflows: >
@pmelab/gtd@27.9.0 test:workflows test:workflows: > vitest run --project
workflows test:workflows: test:unit: fatal: path 'missing.txt' does not exist in
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
private key test:unit: ...........................................+++++
test:unit: ..............+++++ test:unit: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-xrJZiR/key.pem'
test:unit: ----- test:unit: (node:82867) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: Finished in 53ms on 1 files using 10 threads. test:unit: Finished in
57ms on 1 files using 10 threads. test:unit: Finished in 48ms on 1 files using
10 threads. test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-rSs3bY
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two test:e2e:live: Generating
a 2048 bit RSA private key test:e2e:live: ............+++++ test:e2e:live:
................................................+++++ test:e2e:live: writing new
private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-test-8MYZpo/key.pem'
test:e2e:live: ----- test:e2e:live: (node:82949) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:e2e:live: (node:6395) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created)

Tasks: 6 successful, 6 total Cached: 0 cached, 6 total Time: 3m49.756s

test-states: naive_pass on — pass • turbo 2.10.9

• Running test:unit, test:workflows, test:e2e:inmem, test:e2e:live, test:web •
Remote caching disabled, using shared worktree cache

build: cache hit, replaying logs 26ee2ff926bad118 build: build: >
@pmelab/gtd@27.9.0 build build: > tsdown --filter web && npx @tailwindcss/cli -i
src/web/styles.css -o dist/web/main.css --minify && node
scripts/inline-web-client.mjs && tsdown --filter gtd && tsdown --filter
workflows && tsdown --filter entrypoints build: build: [34mℹ[39m [34mtsdown
v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m
config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m tsconfig:
[38;2;100;116;180mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 1 files build: [34mℹ[39m [38;2;100;116;180m[web][39m Hint:
consider adding [34mdeps.onlyBundle[39m option to avoid unintended bundling of
dependencies, or set [34mdeps.onlyBundle: false[39m to disable this hint.
test:web: cache miss, executing 6a8091859eeb2653 build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m build: Detected
dependencies in bundle: build: - [34mreact[39m build: -
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
build: ≈ tailwindcss v4.3.3 build: build: Done in 60ms build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/tsdown.config.ts[24m
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
[38;2;155;180;100m[gtd][39m Build complete in [32m155ms[39m build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/tsdown.config.ts[24m
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
[2m1.16 MB[22m build: [34mℹ[39m [38;2;180;100;127m[workflows][39m 1 files,
total: 1.16 MB build: [32m✔[39m [38;2;180;100;127m[workflows][39m Build complete
in [32m95ms[39m build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/tsdown.config.ts[24m
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
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mtestkit.mjs[22m [2m591.98
kB[22m [2m│ gzip: 159.95 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/feature.mjs[22m [2m
33.77 kB[22m [2m│ gzip: 10.90 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mflows.mjs[22m [2m 28.10
kB[22m [2m│ gzip: 9.46 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflow-kit.mjs[22m [2m
13.55 kB[22m [2m│ gzip: 4.78 kB[22m build: [34mℹ[39m
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
[2mdist/[22mchunks/reserved-t6C7OgLD.mjs [2m 86.68 kB[22m [2m│ gzip: 28.81
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/wire-D3Rc5r22.mjs [2m 19.76 kB[22m [2m│ gzip: 7.74 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/tail-6vtSmzlV.mjs [2m 4.39 kB[22m [2m│ gzip: 1.77 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/rolldown-runtime-8H4AJuhK.mjs [2m 0.38 kB[22m [2m│ gzip: 0.27
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m 16 files, total:
2.01 MB build: [32m✔[39m [38;2;180;171;100m[entrypoints][39m Build complete in
[32m194ms[39m build: build: > @pmelab/gtd@27.9.0 postbuild build: > node
scripts/assert-no-test-doubles.mjs build: test:e2e:live: cache miss, executing
8e25a2cac9562810 test:unit: cache miss, executing 3b3ca7c59eb5ddd1
test:workflows: cache miss, executing 5c0633a857b785db test:e2e:inmem: cache
miss, executing a1e92dffce07d8a8 test:workflows: test:workflows: >
@pmelab/gtd@27.9.0 test:workflows test:workflows: > vitest run --project
workflows test:workflows: test:web: test:web: > @pmelab/gtd@27.9.0 test:web
test:web: > vitest run --project storybook test:web: test:e2e:live:
test:e2e:live: > @pmelab/gtd@27.9.0 test:e2e:live test:e2e:live: > vitest run
--project e2e-live --no-file-parallelism test:e2e:live: test:e2e:inmem:
test:e2e:inmem: > @pmelab/gtd@27.9.0 test:e2e:inmem test:e2e:inmem: > vitest run
--project e2e-inmem test:e2e:inmem: test:unit: test:unit: > @pmelab/gtd@27.9.0
test:unit test:unit: > vitest run --project unit test:unit: test:unit: fatal:
path 'missing.txt' does not exist in 'HEAD' test:unit: fatal: invalid object
name 'HEAD'. test:unit: warning: adding embedded git repository: sub test:unit:
hint: You've added another git repository inside your current repository.
test:unit: hint: Clones of the outer repository will not contain the contents of
test:unit: hint: the embedded repository and will not know how to obtain it.
test:unit: hint: If you meant to add a submodule, use: test:unit: hint:
test:unit: hint: git submodule add <url> sub test:unit: hint: test:unit: hint:
If you added this path by mistake, you can remove it from the test:unit: hint:
index with: test:unit: hint: test:unit: hint: git rm --cached sub test:unit:
hint: test:unit: hint: See "git help submodule" for more information. test:unit:
hint: Disable this message with "git config set advice.addEmbeddedRepo false"
test:unit: Generating a 2048 bit RSA private key test:unit:
...............................+++++ test:unit:
...............................................................................................+++++
test:unit: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-9Njkxn/key.pem'
test:unit: ----- test:unit: (node:71307) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: Finished in 183ms on 1 files using 10 threads. test:unit: Finished in
165ms on 1 files using 10 threads. test:unit: Finished in 118ms on 1 files using
10 threads. test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-ESjby7
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two test:e2e:live: Generating
a 2048 bit RSA private key test:e2e:live:
............................................+++++ test:e2e:live:
...............................+++++ test:e2e:live: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-test-x8Khvz/key.pem'
test:e2e:live: ----- test:e2e:live: (node:13178) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:e2e:live: (node:25400) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created)

Tasks: 6 successful, 6 total Cached: 1 cached, 6 total Time: 4m5.722s

test-states: risk_tier on — pass

<!-- gtd check 123f357 -->
