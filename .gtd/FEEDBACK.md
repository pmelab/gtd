> @pmelab/gtd@27.9.0 test jiti scripts/test-states.main.ts

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, lint:boundaries, test:unit,
test:workflows, test:e2e:inmem, test:e2e:live, test:web, analyze • Remote
caching disabled, using shared worktree cache

format:check: cache hit, replaying logs 3c2847ce8e794c81 format:check:
format:check: > @pmelab/gtd@27.9.0 format:check format:check: > oxfmt --check .
format:check: format:check: Checking formatting... format:check: format:check:
All matched files use the correct format. format:check: Finished in 726ms on 538
files using 10 threads. build: cache hit, replaying logs 3702209cd142e36d
lint:sh: cache hit, replaying logs 53153691a8027fdb build: build: >
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
build: - [34mmdast-util-gfm-task-list-item[39m typecheck: cache hit, replaying
logs 97641ce893c13185 lint: cache hit, replaying logs 81d5941f2b369c3c lint:
lint: > @pmelab/gtd@27.9.0 lint lint: > oxlint . lint: lint: Found 0 warnings
and 0 errors. lint: Finished in 35ms on 464 files with 117 rules using 10
threads. typecheck: typecheck: > @pmelab/gtd@27.9.0 typecheck typecheck: > tsc
--noEmit && tsc --noEmit -p src/web/tsconfig.json typecheck: lint:boundaries:
cache hit, replaying logs e89ff82c9e532b84 lint:boundaries: lint:boundaries: >
@pmelab/gtd@27.9.0 lint:boundaries lint:boundaries: > depcruise src tests claude
lint:boundaries: lint:boundaries: lint:boundaries: ✔ no dependency violations
found (505 modules, 1867 dependencies cruised) lint:boundaries: analyze: cache
hit, replaying logs 98765058abc30ad3 build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34mzustand[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.26
MB[22m build: [34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.26 MB
build: [32m✔[39m [38;2;100;116;180m[web][39m Build complete in [32m200ms[39m
build: ≈ tailwindcss v4.3.3 build: build: Done in 72ms build: [34mℹ[39m
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
[38;2;155;180;100m[gtd][39m Build complete in [32m221ms[39m build: [34mℹ[39m
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
in [32m175ms[39m build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
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
[34m@effect/platform-node[39m test:web: cache hit, replaying logs
11e09cd05451d20b build: - [34mmdast-util-to-string[39m build: -
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
[34mmdast-util-gfm-footnote[39m lint:sh: lint:sh: > @pmelab/gtd@27.9.0 lint:sh
lint:sh: > jiti scripts/generate-shell-corpus.ts --check && shellcheck -s sh
tests/shell/corpus/*.sh lint:sh: lint:sh: tests/shell/corpus/ is up to date (31
files) build: - [34mmdast-util-gfm-strikethrough[39m build: -
[34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mtestkit.mjs[22m [2m591.98
kB[22m [2m│ gzip: 159.95 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/feature.mjs[22m [2m
33.59 kB[22m [2m│ gzip: 10.84 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mflows.mjs[22m [2m 28.10
kB[22m [2m│ gzip: 9.46 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflow-kit.mjs[22m [2m
12.49 kB[22m [2m│ gzip: 4.54 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/rollout.mjs[22m [2m
2.59 kB[22m [2m│ gzip: 1.16 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/cleanup.mjs[22m [2m
2.16 kB[22m [2m│ gzip: 0.99 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/fix.mjs[22m [2m
2.09 kB[22m [2m│ gzip: 0.95 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/review.mjs[22m [2m
1.14 kB[22m [2m│ gzip: 0.60 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mwire.mjs[22m [2m 1.11 kB[22m
[2m│ gzip: 0.48 kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22m[1msteering.mjs[22m [2m 1.05 kB[22m [2m│ gzip: 0.42 kB[22m build:
[34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/Schema-DO5ttJaI.mjs [2m778.68 kB[22m [2m│ gzip: 167.57 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/steering-DVILanVf.mjs [2m437.58 kB[22m [2m│ gzip: 105.05
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/reserved-D73EjBQq.mjs [2m 86.14 kB[22m [2m│ gzip: 28.66
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/wire-D3Rc5r22.mjs [2m 19.76 kB[22m [2m│ gzip: 7.74 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/tail-DeGUONF3.mjs [2m 4.36 kB[22m [2m│ gzip: 1.76 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/rolldown-runtime-8H4AJuhK.mjs [2m 0.38 kB[22m [2m│ gzip: 0.27
kB[22m test:web: test:web: > @pmelab/gtd@27.9.0 test:web test:web: > vitest run
--project storybook test:web: build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m 16 files, total: 2.00 MB build: [32m✔[39m
[38;2;180;171;100m[entrypoints][39m Build complete in [32m235ms[39m build:
build: > @pmelab/gtd@27.9.0 postbuild build: > node
scripts/assert-no-test-doubles.mjs build: analyze: analyze: > @pmelab/gtd@27.9.0
analyze analyze: > fallow --summary --quiet analyze: analyze: Duplication
Summary analyze: analyze: 10 Clone families analyze: 23 Clone groups analyze:
3,834 Duplicated lines analyze: 6.6% Duplication rate analyze: Health Summary
analyze: analyze: 11897 Functions analyzed analyze: 0 Above threshold analyze:
90.8 Average maintainability (good) test:e2e:live: cache hit, replaying logs
252e73c3e2583013 test:e2e:live: test:e2e:live: > @pmelab/gtd@27.9.0
test:e2e:live test:e2e:live: > vitest run --project e2e-live
--no-file-parallelism test:e2e:live: test:e2e:live: (node:56859) Warning:
Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS
connections and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:e2e:live: Generating a 2048 bit RSA private key test:e2e:live:
............+++++ test:e2e:live: ...+++++ test:e2e:live: writing new private key
to '/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-test-eSmPlm/key.pem'
test:e2e:live: ----- test:e2e:live: (node:9149) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:workflows: cache hit, replaying logs 77d3716e2d5ef1f9
test:workflows: test:workflows: > @pmelab/gtd@27.9.0 test:workflows
test:workflows: > vitest run --project workflows test:workflows: test:unit:
cache hit, replaying logs 858a4ef14345f0b0 test:unit: test:unit: >
@pmelab/gtd@27.9.0 test:unit test:unit: > vitest run --project unit test:unit:
test:unit: fatal: path 'missing.txt' does not exist in 'HEAD' test:unit: fatal:
invalid object name 'HEAD'. test:unit: warning: adding embedded git repository:
sub test:unit: hint: You've added another git repository inside your current
repository. test:unit: hint: Clones of the outer repository will not contain the
contents of test:unit: hint: the embedded repository and will not know how to
obtain it. test:unit: hint: If you meant to add a submodule, use: test:unit:
hint: test:unit: hint: git submodule add <url> sub test:unit: hint: test:unit:
hint: If you added this path by mistake, you can remove it from the test:unit:
hint: index with: test:unit: hint: test:unit: hint: git rm --cached sub
test:unit: hint: test:unit: hint: See "git help submodule" for more information.
test:unit: hint: Disable this message with "git config set
advice.addEmbeddedRepo false" test:unit: Generating a 2048 bit RSA private key
test:unit:
...........................................................................................+++++
test:unit:
................................................................................................+++++
test:unit: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-qRoDVt/key.pem'
test:unit: ----- test:unit: Finished in 45ms on 1 files using 10 threads.
test:unit: Finished in 43ms on 1 files using 10 threads. test:unit: Finished in
72ms on 1 files using 10 threads. test:unit: (node:46359) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-Q7BiFF
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two test:e2e:inmem: cache
hit, replaying logs e6aaa02b14d41de7 test:e2e:inmem: test:e2e:inmem: >
@pmelab/gtd@27.9.0 test:e2e:inmem test:e2e:inmem: > vitest run --project
e2e-inmem test:e2e:inmem:

Tasks: 12 successful, 12 total Cached: 12 cached, 12 total Time: 32ms >>> FULL
TURBO

test-states: defaults — pass • turbo 2.10.9

• Running test:unit, test:workflows, test:e2e:inmem, test:e2e:live, test:web •
Remote caching disabled, using shared worktree cache

test:web: cache hit, replaying logs f649935db09b54dc test:web: test:web: >
@pmelab/gtd@27.9.0 test:web test:web: > vitest run --project storybook test:web:
build: cache hit, replaying logs 3702209cd142e36d build: build: >
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
build: [32m✔[39m [38;2;100;116;180m[web][39m Build complete in [32m200ms[39m
build: ≈ tailwindcss v4.3.3 build: build: Done in 72ms build: [34mℹ[39m
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
[38;2;155;180;100m[gtd][39m Build complete in [32m221ms[39m build: [34mℹ[39m
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
in [32m175ms[39m build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
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
33.59 kB[22m [2m│ gzip: 10.84 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mflows.mjs[22m [2m 28.10
kB[22m [2m│ gzip: 9.46 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflow-kit.mjs[22m [2m
12.49 kB[22m [2m│ gzip: 4.54 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/rollout.mjs[22m [2m
2.59 kB[22m [2m│ gzip: 1.16 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/cleanup.mjs[22m [2m
2.16 kB[22m [2m│ gzip: 0.99 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/fix.mjs[22m [2m
2.09 kB[22m [2m│ gzip: 0.95 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/review.mjs[22m [2m
1.14 kB[22m [2m│ gzip: 0.60 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mwire.mjs[22m [2m 1.11 kB[22m
[2m│ gzip: 0.48 kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22m[1msteering.mjs[22m [2m 1.05 kB[22m [2m│ gzip: 0.42 kB[22m build:
[34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/Schema-DO5ttJaI.mjs [2m778.68 kB[22m [2m│ gzip: 167.57 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/steering-DVILanVf.mjs [2m437.58 kB[22m [2m│ gzip: 105.05
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/reserved-D73EjBQq.mjs [2m 86.14 kB[22m [2m│ gzip: 28.66
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/wire-D3Rc5r22.mjs [2m 19.76 kB[22m [2m│ gzip: 7.74 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/tail-DeGUONF3.mjs [2m 4.36 kB[22m [2m│ gzip: 1.76 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/rolldown-runtime-8H4AJuhK.mjs [2m 0.38 kB[22m [2m│ gzip: 0.27
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m 16 files, total:
2.00 MB build: [32m✔[39m [38;2;180;171;100m[entrypoints][39m Build complete in
[32m235ms[39m build: build: > @pmelab/gtd@27.9.0 postbuild build: > node
scripts/assert-no-test-doubles.mjs build: test:e2e:live: cache miss, executing
e96a81889359e891 test:e2e:inmem: cache hit, replaying logs 0dd7f2a079962988
test:unit: cache miss, executing dbb522b0ed9b28bb test:e2e:inmem:
test:e2e:inmem: > @pmelab/gtd@27.9.0 test:e2e:inmem test:e2e:inmem: > vitest run
--project e2e-inmem test:e2e:inmem: test:workflows: cache hit, replaying logs
4e31006a321bc25c test:workflows: test:workflows: > @pmelab/gtd@27.9.0
test:workflows test:workflows: > vitest run --project workflows test:workflows:
test:unit: test:unit: > @pmelab/gtd@27.9.0 test:unit test:unit: > vitest run
--project unit test:unit: test:e2e:live: test:e2e:live: > @pmelab/gtd@27.9.0
test:e2e:live test:e2e:live: > vitest run --project e2e-live
--no-file-parallelism test:e2e:live: test:unit: fatal: path 'missing.txt' does
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
with "git config set advice.addEmbeddedRepo false" test:unit: Finished in 185ms
on 1 files using 10 threads. test:unit: Finished in 48ms on 1 files using 10
threads. test:unit: Finished in 47ms on 1 files using 10 threads. test:unit:
Generating a 2048 bit RSA private key test:unit:
.....................................................................................................................................+++++
test:unit: .........+++++ test:unit: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-hCBRvV/key.pem'
test:unit: ----- test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-xIwJ0F
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two test:unit: (node:86217)
Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0'
makes TLS connections and HTTPS requests insecure by disabling certificate
verification. test:unit: (Use `node --trace-warnings ...` to show where the
warning was created) test:e2e:live: Generating a 2048 bit RSA private key
test:e2e:live:
.................................................................................................................................................................................................................................+++++
test:e2e:live: ..........+++++ test:e2e:live: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-test-AHgfl2/key.pem'
test:e2e:live: ----- test:e2e:live: (node:62332) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:e2e:live: (node:23436) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:e2e:live: test:e2e:live: FAIL Feature: gtd loop drives a process
until it rests on a human > Scenario Outline: A signal kills the loop with its
promised status and takes the whole agent turn with it (@live) test:e2e:live: I
send SIGTERM to a spawned gtd loop mid agent turn (#143) test:e2e:live: gtd loop
never started its agent turn test:e2e:live: at
/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/tests/integration/features/loop.feature:143:1
test:e2e:live: test:e2e:live: 1 test(s) failed test:e2e:live: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/)
/Users/pmelab/.herdr/worktrees/gtd/feat-381-naive-pass-slices/node_modules/.bin/npm
run test:e2e:live exited (1)

Tasks: 5 successful, 6 total Cached: 4 cached, 6 total Time: 5m27.459s Failed:
//#test:e2e:live

ERROR run failed: command exited (1) test-states: naive_pass on — FAIL • turbo
2.10.9

• Running test:unit, test:workflows, test:e2e:inmem, test:e2e:live, test:web •
Remote caching disabled, using shared worktree cache

test:web: cache miss, executing 8c5cc677d6e986aa build: cache hit, replaying
logs 3702209cd142e36d build: build: > @pmelab/gtd@27.9.0 build build: > tsdown
--filter web && npx @tailwindcss/cli -i src/web/styles.css -o dist/web/main.css
--minify && node scripts/inline-web-client.mjs && tsdown --filter gtd && tsdown
--filter workflows && tsdown --filter entrypoints build: build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
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
build: [32m✔[39m [38;2;100;116;180m[web][39m Build complete in [32m200ms[39m
build: ≈ tailwindcss v4.3.3 build: build: Done in 72ms build: [34mℹ[39m
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
[38;2;155;180;100m[gtd][39m Build complete in [32m221ms[39m build: [34mℹ[39m
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
in [32m175ms[39m build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
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
33.59 kB[22m [2m│ gzip: 10.84 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mflows.mjs[22m [2m 28.10
kB[22m [2m│ gzip: 9.46 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflow-kit.mjs[22m [2m
12.49 kB[22m [2m│ gzip: 4.54 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/rollout.mjs[22m [2m
2.59 kB[22m [2m│ gzip: 1.16 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/cleanup.mjs[22m [2m
2.16 kB[22m [2m│ gzip: 0.99 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/fix.mjs[22m [2m
2.09 kB[22m [2m│ gzip: 0.95 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/review.mjs[22m [2m
1.14 kB[22m [2m│ gzip: 0.60 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mwire.mjs[22m [2m 1.11 kB[22m
[2m│ gzip: 0.48 kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22m[1msteering.mjs[22m [2m 1.05 kB[22m [2m│ gzip: 0.42 kB[22m build:
[34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/Schema-DO5ttJaI.mjs [2m778.68 kB[22m [2m│ gzip: 167.57 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/steering-DVILanVf.mjs [2m437.58 kB[22m [2m│ gzip: 105.05
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/reserved-D73EjBQq.mjs [2m 86.14 kB[22m [2m│ gzip: 28.66
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/wire-D3Rc5r22.mjs [2m 19.76 kB[22m [2m│ gzip: 7.74 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/tail-DeGUONF3.mjs [2m 4.36 kB[22m [2m│ gzip: 1.76 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/rolldown-runtime-8H4AJuhK.mjs [2m 0.38 kB[22m [2m│ gzip: 0.27
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m 16 files, total:
2.00 MB build: [32m✔[39m [38;2;180;171;100m[entrypoints][39m Build complete in
[32m235ms[39m build: build: > @pmelab/gtd@27.9.0 postbuild build: > node
scripts/assert-no-test-doubles.mjs build: test:unit: cache miss, executing
50578704dddeb69e test:workflows: cache miss, executing 7589977404962b30
test:e2e:live: cache miss, executing 5588b9482a742575 test:e2e:inmem: cache
miss, executing 70b3c667c799b907 test:e2e:live: test:e2e:live: >
@pmelab/gtd@27.9.0 test:e2e:live test:e2e:live: > vitest run --project e2e-live
--no-file-parallelism test:e2e:live: test:unit: test:unit: > @pmelab/gtd@27.9.0
test:unit test:unit: > vitest run --project unit test:unit: test:web:
test:web: > @pmelab/gtd@27.9.0 test:web test:web: > vitest run --project
storybook test:web: test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@27.9.0
test:e2e:inmem test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem:
test:workflows: test:workflows: > @pmelab/gtd@27.9.0 test:workflows
test:workflows: > vitest run --project workflows test:workflows: test:unit:
fatal: path 'missing.txt' does not exist in 'HEAD' test:unit: fatal: invalid
object name 'HEAD'. test:unit: warning: adding embedded git repository: sub
test:unit: hint: You've added another git repository inside your current
repository. test:unit: hint: Clones of the outer repository will not contain the
contents of test:unit: hint: the embedded repository and will not know how to
obtain it. test:unit: hint: If you meant to add a submodule, use: test:unit:
hint: test:unit: hint: git submodule add <url> sub test:unit: hint: test:unit:
hint: If you added this path by mistake, you can remove it from the test:unit:
hint: index with: test:unit: hint: test:unit: hint: git rm --cached sub
test:unit: hint: test:unit: hint: See "git help submodule" for more information.
test:unit: hint: Disable this message with "git config set
advice.addEmbeddedRepo false" test:unit: Generating a 2048 bit RSA private key
test:unit: ..............................................+++++ test:unit:
.....................................................................................+++++
test:unit: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-iE2vC0/key.pem'
test:unit: ----- test:unit: Finished in 41ms on 1 files using 10 threads.
test:unit: Finished in 81ms on 1 files using 10 threads. test:unit: Finished in
110ms on 1 files using 10 threads. test:unit: (node:59959) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-JNWwSl
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two test:e2e:live: Generating
a 2048 bit RSA private key test:e2e:live: .......................+++++
test:e2e:live:
............................................................................................................................................................................+++++
test:e2e:live: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-test-qsLAZA/key.pem'
test:e2e:live: ----- test:e2e:live: (node:50823) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:e2e:live: (node:71272) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created)

Tasks: 6 successful, 6 total Cached: 1 cached, 6 total Time: 4m19.687s

test-states: risk_tier on — pass

<!-- gtd check de64449 -->
