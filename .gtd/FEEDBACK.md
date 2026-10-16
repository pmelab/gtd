> @pmelab/gtd@27.6.0 test jiti scripts/test-states.main.ts

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, lint:boundaries, test:unit,
test:workflows, test:e2e:inmem, test:e2e:live, test:web, analyze • Remote
caching disabled, using shared worktree cache

lint:sh: cache hit, replaying logs 991e8b18717a5dde build: cache hit, replaying
logs fab54aad2050b2e8 lint:boundaries: cache hit, replaying logs
2832f42b38bbf030 build: build: > @pmelab/gtd@27.6.0 build lint:sh: lint:sh: >
@pmelab/gtd@27.6.0 lint:sh lint:sh: > jiti scripts/generate-shell-corpus.ts
--check && shellcheck -s sh tests/shell/corpus/*.sh lint:sh: build: > tsdown
--filter web && npx @tailwindcss/cli -i src/web/styles.css -o dist/web/main.css
--minify && node scripts/inline-web-client.mjs && tsdown --filter gtd && tsdown
--filter workflows && tsdown --filter entrypoints lint:boundaries:
lint:boundaries: > @pmelab/gtd@27.6.0 lint:boundaries build: build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;100;116;180m[web][39m entry:
[38;2;100;116;180msrc/web/main.tsx[39m build: [34mℹ[39m
[38;2;100;116;180m[web][39m target: [38;2;100;116;180mesnext[39m lint:sh:
tests/shell/corpus/ is up to date (31 files) build: [34mℹ[39m
[38;2;100;116;180m[web][39m tsconfig: [38;2;100;116;180mtsconfig.json[39m build:
[34mℹ[39m Build start build: [34mℹ[39m Cleaning 2 files build: [34mℹ[39m
[38;2;100;116;180m[web][39m Hint: consider adding [34mdeps.onlyBundle[39m option
to avoid unintended bundling of dependencies, or set [34mdeps.onlyBundle:
false[39m to disable this hint. build: See more at
[4mhttps://tsdown.dev/options/dependencies#deps-onlybundle[24m test:web: cache
hit, replaying logs bc58f2dbfe95449f build: Detected dependencies in bundle:
test:web: test:web: > @pmelab/gtd@27.6.0 test:web test:web: > vitest run
--project storybook test:web: lint:boundaries: > depcruise src tests claude
lint:boundaries: lint:boundaries: lint:boundaries: ✔ no dependency violations
found (493 modules, 1819 dependencies cruised) lint:boundaries: build: -
[34mreact[39m build: - [34m@tanstack/react-query[39m build: -
[34m@tanstack/query-core[39m build: - [34m@trpc/client[39m build: -
[34m@trpc/server[39m build: - [34mscheduler[39m build: - [34mreact-dom[39m
build: - [34m@trpc/react-query[39m build: - [34mtailwind-merge[39m build: -
[34mmdast-util-to-string[39m build: - [34mdecode-named-character-reference[39m
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
[34mmicromark-extension-gfm-task-list-item[39m build: - [34mzustand[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.26
MB[22m build: [34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.26 MB
build: [32m✔[39m [38;2;100;116;180m[web][39m Build complete in [32m241ms[39m
build: ≈ tailwindcss v4.3.3 build: build: Done in 69ms build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
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
[2mdist/[22m[1mgtd.bundle.mjs[22m [2m3.37 MB[22m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m 1 files, total: 3.37 MB build: [32m✔[39m
[38;2;155;180;100m[gtd][39m Build complete in [32m201ms[39m build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
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
in [32m88ms[39m build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m entry:
[38;2;180;171;100msrc/flows/index.ts, src/wire/index.ts, src/steering/index.ts,
src/workflow-kit/index.ts, src/workflows/feature/index.ts,
src/workflows/review/index.ts, src/workflows/fix/index.ts,
src/workflows/rollout/index.ts, src/workflows/cleanup/index.ts,
src/testkit/index.ts[39m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
target: [38;2;180;171;100mnode20[39m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m tsconfig:
[38;2;180;171;100mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 19 files build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
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
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mtestkit.mjs[22m [2m585.19
kB[22m [2m│ gzip: 158.10 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/feature.mjs[22m [2m
27.99 kB[22m [2m│ gzip: 9.43 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mflows.mjs[22m [2m 27.72
kB[22m [2m│ gzip: 9.35 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflow-kit.mjs[22m [2m
11.89 kB[22m [2m│ gzip: 4.32 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/cleanup.mjs[22m [2m
2.19 kB[22m [2m│ gzip: 1.00 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/fix.mjs[22m [2m
2.08 kB[22m [2m│ gzip: 0.94 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/rollout.mjs[22m [2m
1.95 kB[22m [2m│ gzip: 0.89 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/review.mjs[22m [2m
1.13 kB[22m [2m│ gzip: 0.60 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1msteering.mjs[22m [2m 1.05
kB[22m [2m│ gzip: 0.42 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mwire.mjs[22m [2m 1.03 kB[22m
[2m│ gzip: 0.46 kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/Schema-DO5ttJaI.mjs [2m778.68 kB[22m [2m│ gzip: 167.57 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/steering-DVILanVf.mjs [2m437.58 kB[22m [2m│ gzip: 105.05
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/reserved-Df8GeSHw.mjs [2m 74.47 kB[22m [2m│ gzip: 24.68
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/wire-C12dahrH.mjs [2m 19.36 kB[22m [2m│ gzip: 7.62 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/registry-CP3YuV9j.mjs [2m 4.53 kB[22m [2m│ gzip: 1.87 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/tail-DmIfEAI4.mjs [2m 4.02 kB[22m [2m│ gzip: 1.66 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/rolldown-runtime-8H4AJuhK.mjs [2m 0.38 kB[22m [2m│ gzip: 0.27
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m 17 files, total:
1.98 MB build: [32m✔[39m [38;2;180;171;100m[entrypoints][39m Build complete in
[32m237ms[39m build: build: > @pmelab/gtd@27.6.0 postbuild build: > node
scripts/assert-no-test-doubles.mjs build: test:e2e:inmem: cache hit, replaying
logs 6d00bc43c138cf0f test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@27.6.0
test:e2e:inmem test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem:
test:e2e:live: cache hit, replaying logs 341bda1419841858 test:e2e:live:
test:e2e:live: > @pmelab/gtd@27.6.0 test:e2e:live test:e2e:live: > vitest run
--project e2e-live --no-file-parallelism test:e2e:live: test:e2e:live:
(node:27514) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED environment
variable to '0' makes TLS connections and HTTPS requests insecure by disabling
certificate verification. test:e2e:live: (Use `node --trace-warnings ...` to
show where the warning was created) test:e2e:live: Generating a 2048 bit RSA
private key test:e2e:live: ..+++++ test:e2e:live: .............+++++
test:e2e:live: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-test-4MWBlX/key.pem'
test:e2e:live: ----- test:e2e:live: (node:41584) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:workflows: cache hit, replaying logs 866fdfe2295c11c9
test:workflows: test:workflows: > @pmelab/gtd@27.6.0 test:workflows
test:workflows: > vitest run --project workflows test:workflows: format:check:
cache miss, executing e9c4da6abd02fff1 analyze: cache miss, executing
dc4932611455abb9 lint: cache miss, executing 1a3df43745247318 typecheck: cache
miss, executing 8ee864e17f15a0e5 test:unit: cache miss, executing
21339fdbc62471b9 format:check: format:check: > @pmelab/gtd@27.6.0 format:check
format:check: > oxfmt --check . format:check: lint: lint: > @pmelab/gtd@27.6.0
lint lint: > oxlint . lint: analyze: analyze: > @pmelab/gtd@27.6.0 analyze
analyze: > fallow --summary --quiet analyze: typecheck: typecheck: >
@pmelab/gtd@27.6.0 typecheck typecheck: > tsc --noEmit && tsc --noEmit -p
src/web/tsconfig.json typecheck: test:unit: test:unit: > @pmelab/gtd@27.6.0
test:unit test:unit: > vitest run --project unit test:unit: format:check:
Checking formatting... format:check: lint: Found 0 warnings and 0 errors. lint:
Finished in 43ms on 452 files with 117 rules using 10 threads. format:check: All
matched files use the correct format. format:check: Finished in 566ms on 521
files using 10 threads. analyze: Duplication Summary analyze: analyze: 10 Clone
families analyze: 23 Clone groups analyze: 3,820 Duplicated lines analyze: 6.8%
Duplication rate analyze: Health Summary analyze: analyze: 11081 Functions
analyzed analyze: 0 Above threshold analyze: 90.8 Average maintainability (good)
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
...................................................................................................................+++++
test:unit: ................................................+++++ test:unit:
writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-K59bWL/key.pem'
test:unit: ----- test:unit: Finished in 45ms on 1 files using 10 threads.
test:unit: Finished in 36ms on 1 files using 10 threads. test:unit: Finished in
56ms on 1 files using 10 threads. test:unit: (node:12023) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-L0kF5r
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two test:unit: test:unit:
FAIL this repository's config > loads, running the shipped workflows test:unit:
expected [ 'cleanup', 'feature', 'fix', …(2) ] to deeply equal [ 'feature',
'fix', 'review' ] test:unit: AssertionError: expected [ 'cleanup', 'feature',
'fix', …(2) ] to deeply equal [ 'feature', 'fix', 'review' ] test:unit:
test:unit: 1 test(s) failed test:unit: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/)
/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/node_modules/.bin/npm run
test:unit exited (1)

Tasks: 11 successful, 12 total Cached: 7 cached, 12 total Time: 1m15.075s
Failed: //#test:unit

ERROR run failed: command exited (1) test-states: defaults — FAIL • turbo 2.10.9

• Running test:unit, test:workflows, test:e2e:inmem, test:e2e:live, test:web •
Remote caching disabled, using shared worktree cache

build: cache hit, replaying logs fab54aad2050b2e8 build: build: >
@pmelab/gtd@27.6.0 build build: > tsdown --filter web && npx @tailwindcss/cli -i
src/web/styles.css -o dist/web/main.css --minify && node
scripts/inline-web-client.mjs && tsdown --filter gtd && tsdown --filter
workflows && tsdown --filter entrypoints build: build: [34mℹ[39m [34mtsdown
v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m
config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
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
[34mescape-string-regexp[39m build: - [34munist-util-is[39m test:web: cache hit,
replaying logs 1259fbc2a44aa2e3 build: - [34munist-util-visit-parents[39m
build: - [34mmdast-util-find-and-replace[39m build: -
[34mmdast-util-gfm-autolink-literal[39m build: - [34mmdast-util-gfm-footnote[39m
build: - [34mmdast-util-gfm-strikethrough[39m build: -
[34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34mzustand[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.26
MB[22m build: [34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.26 MB
test:web: test:web: > @pmelab/gtd@27.6.0 test:web test:web: > vitest run
--project storybook test:web: build: [32m✔[39m [38;2;100;116;180m[web][39m Build
complete in [32m241ms[39m build: ≈ tailwindcss v4.3.3 build: build: Done in 69ms
build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown
v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
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
[2mdist/[22m[1mgtd.bundle.mjs[22m [2m3.37 MB[22m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m 1 files, total: 3.37 MB build: [32m✔[39m
[38;2;155;180;100m[gtd][39m Build complete in [32m201ms[39m build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
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
in [32m88ms[39m build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m entry:
[38;2;180;171;100msrc/flows/index.ts, src/wire/index.ts, src/steering/index.ts,
src/workflow-kit/index.ts, src/workflows/feature/index.ts,
src/workflows/review/index.ts, src/workflows/fix/index.ts,
src/workflows/rollout/index.ts, src/workflows/cleanup/index.ts,
src/testkit/index.ts[39m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
target: [38;2;180;171;100mnode20[39m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m tsconfig:
[38;2;180;171;100mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 19 files build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
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
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mtestkit.mjs[22m [2m585.19
kB[22m [2m│ gzip: 158.10 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/feature.mjs[22m [2m
27.99 kB[22m [2m│ gzip: 9.43 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mflows.mjs[22m [2m 27.72
kB[22m [2m│ gzip: 9.35 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflow-kit.mjs[22m [2m
11.89 kB[22m [2m│ gzip: 4.32 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/cleanup.mjs[22m [2m
2.19 kB[22m [2m│ gzip: 1.00 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/fix.mjs[22m [2m
2.08 kB[22m [2m│ gzip: 0.94 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/rollout.mjs[22m [2m
1.95 kB[22m [2m│ gzip: 0.89 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/review.mjs[22m [2m
1.13 kB[22m [2m│ gzip: 0.60 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1msteering.mjs[22m [2m 1.05
kB[22m [2m│ gzip: 0.42 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mwire.mjs[22m [2m 1.03 kB[22m
[2m│ gzip: 0.46 kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/Schema-DO5ttJaI.mjs [2m778.68 kB[22m [2m│ gzip: 167.57 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/steering-DVILanVf.mjs [2m437.58 kB[22m [2m│ gzip: 105.05
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/reserved-Df8GeSHw.mjs [2m 74.47 kB[22m [2m│ gzip: 24.68
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/wire-C12dahrH.mjs [2m 19.36 kB[22m [2m│ gzip: 7.62 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/registry-CP3YuV9j.mjs [2m 4.53 kB[22m [2m│ gzip: 1.87 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/tail-DmIfEAI4.mjs [2m 4.02 kB[22m [2m│ gzip: 1.66 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/rolldown-runtime-8H4AJuhK.mjs [2m 0.38 kB[22m [2m│ gzip: 0.27
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m 17 files, total:
1.98 MB build: [32m✔[39m [38;2;180;171;100m[entrypoints][39m Build complete in
[32m237ms[39m build: build: > @pmelab/gtd@27.6.0 postbuild build: > node
scripts/assert-no-test-doubles.mjs build: test:e2e:inmem: cache hit, replaying
logs 0f2ffef6a42d8e1f test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@27.6.0
test:e2e:inmem test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem:
test:unit: cache miss, executing bace8f966f750ef3 test:workflows: cache hit,
replaying logs e843111260543d5a test:workflows: test:workflows: >
@pmelab/gtd@27.6.0 test:workflows test:workflows: > vitest run --project
workflows test:workflows: test:e2e:live: cache hit, replaying logs
1e33bc8cccb84a57 test:e2e:live: test:e2e:live: > @pmelab/gtd@27.6.0
test:e2e:live test:e2e:live: > vitest run --project e2e-live
--no-file-parallelism test:e2e:live: test:e2e:live: (node:31382) Warning:
Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS
connections and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:e2e:live: Generating a 2048 bit RSA private key test:e2e:live:
.....+++++ test:e2e:live: ..................+++++ test:e2e:live: writing new
private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-test-vkYSt2/key.pem'
test:e2e:live: ----- test:e2e:live: (node:45553) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:unit: test:unit: > @pmelab/gtd@27.6.0 test:unit test:unit: >
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
bit RSA private key test:unit: ...+++++ test:unit: .+++++ test:unit: writing new
private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-dlCvY6/key.pem'
test:unit: ----- test:unit: Finished in 58ms on 1 files using 10 threads.
test:unit: Finished in 69ms on 1 files using 10 threads. test:unit: Finished in
88ms on 1 files using 10 threads. test:unit: (node:3646) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-JCBTPv
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two test:unit: test:unit:
FAIL this repository's config > loads, running the shipped workflows test:unit:
expected [ 'cleanup', 'feature', 'fix', …(2) ] to deeply equal [ 'feature',
'fix', 'review' ] test:unit: AssertionError: expected [ 'cleanup', 'feature',
'fix', …(2) ] to deeply equal [ 'feature', 'fix', 'review' ] test:unit:
test:unit: 1 test(s) failed test:unit: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/)
/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/node_modules/.bin/npm run
test:unit exited (1)

Tasks: 5 successful, 6 total Cached: 5 cached, 6 total Time: 1m10.366s Failed:
//#test:unit

ERROR run failed: command exited (1) test-states: naive_pass on — FAIL • turbo
2.10.9

• Running test:unit, test:workflows, test:e2e:inmem, test:e2e:live, test:web •
Remote caching disabled, using shared worktree cache

build: cache hit, replaying logs fab54aad2050b2e8 build: build: >
@pmelab/gtd@27.6.0 build build: > tsdown --filter web && npx @tailwindcss/cli -i
src/web/styles.css -o dist/web/main.css --minify && node
scripts/inline-web-client.mjs && tsdown --filter gtd && tsdown --filter
workflows && tsdown --filter entrypoints build: build: [34mℹ[39m [34mtsdown
v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m
config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
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
[34mescape-string-regexp[39m build: - [34munist-util-is[39m test:web: cache hit,
replaying logs a4888ca5a755fd06 build: - [34munist-util-visit-parents[39m
build: - [34mmdast-util-find-and-replace[39m build: -
[34mmdast-util-gfm-autolink-literal[39m build: - [34mmdast-util-gfm-footnote[39m
build: - [34mmdast-util-gfm-strikethrough[39m build: -
[34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34mzustand[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.26
MB[22m build: [34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.26 MB
build: [32m✔[39m [38;2;100;116;180m[web][39m Build complete in [32m241ms[39m
build: ≈ tailwindcss v4.3.3 build: build: Done in 69ms build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
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
[2mdist/[22m[1mgtd.bundle.mjs[22m [2m3.37 MB[22m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m 1 files, total: 3.37 MB build: [32m✔[39m
[38;2;155;180;100m[gtd][39m Build complete in [32m201ms[39m build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;180;100;127m[workflows][39m entry:
[38;2;180;100;127msrc/workflows/index.ts[39m build: [34mℹ[39m
[38;2;180;100;127m[workflows][39m target: [38;2;180;100;127mnode20[39m build:
[34mℹ[39m [38;2;180;100;127m[workflows][39m tsconfig:
[38;2;180;100;127mtsconfig.json[39m test:web: test:web: > @pmelab/gtd@27.6.0
test:web test:web: > vitest run --project storybook test:web: build: [34mℹ[39m
Build start build: [34mℹ[39m Cleaning 1 files build: [34mℹ[39m
[38;2;180;100;127m[workflows][39m Hint: consider adding [34mdeps.onlyBundle[39m
option to avoid unintended bundling of dependencies, or set [34mdeps.onlyBundle:
false[39m to disable this hint. build: See more at
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
in [32m88ms[39m build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m entry:
[38;2;180;171;100msrc/flows/index.ts, src/wire/index.ts, src/steering/index.ts,
src/workflow-kit/index.ts, src/workflows/feature/index.ts,
src/workflows/review/index.ts, src/workflows/fix/index.ts,
src/workflows/rollout/index.ts, src/workflows/cleanup/index.ts,
src/testkit/index.ts[39m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
target: [38;2;180;171;100mnode20[39m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m tsconfig:
[38;2;180;171;100mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 19 files build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
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
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mtestkit.mjs[22m [2m585.19
kB[22m [2m│ gzip: 158.10 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/feature.mjs[22m [2m
27.99 kB[22m [2m│ gzip: 9.43 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mflows.mjs[22m [2m 27.72
kB[22m [2m│ gzip: 9.35 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflow-kit.mjs[22m [2m
11.89 kB[22m [2m│ gzip: 4.32 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/cleanup.mjs[22m [2m
2.19 kB[22m [2m│ gzip: 1.00 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/fix.mjs[22m [2m
2.08 kB[22m [2m│ gzip: 0.94 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/rollout.mjs[22m [2m
1.95 kB[22m [2m│ gzip: 0.89 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/review.mjs[22m [2m
1.13 kB[22m [2m│ gzip: 0.60 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1msteering.mjs[22m [2m 1.05
kB[22m [2m│ gzip: 0.42 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mwire.mjs[22m [2m 1.03 kB[22m
[2m│ gzip: 0.46 kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/Schema-DO5ttJaI.mjs [2m778.68 kB[22m [2m│ gzip: 167.57 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/steering-DVILanVf.mjs [2m437.58 kB[22m [2m│ gzip: 105.05
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/reserved-Df8GeSHw.mjs [2m 74.47 kB[22m [2m│ gzip: 24.68
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/wire-C12dahrH.mjs [2m 19.36 kB[22m [2m│ gzip: 7.62 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/registry-CP3YuV9j.mjs [2m 4.53 kB[22m [2m│ gzip: 1.87 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/tail-DmIfEAI4.mjs [2m 4.02 kB[22m [2m│ gzip: 1.66 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/rolldown-runtime-8H4AJuhK.mjs [2m 0.38 kB[22m [2m│ gzip: 0.27
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m 17 files, total:
1.98 MB build: [32m✔[39m [38;2;180;171;100m[entrypoints][39m Build complete in
[32m237ms[39m build: build: > @pmelab/gtd@27.6.0 postbuild build: > node
scripts/assert-no-test-doubles.mjs build: test:workflows: cache hit, replaying
logs cb657d4e2cee5ed4 test:workflows: test:workflows: > @pmelab/gtd@27.6.0
test:workflows test:workflows: > vitest run --project workflows test:workflows:
test:e2e:inmem: cache hit, replaying logs e795a3644254cbde test:e2e:inmem:
test:e2e:inmem: > @pmelab/gtd@27.6.0 test:e2e:inmem test:e2e:inmem: > vitest run
--project e2e-inmem test:e2e:inmem: test:e2e:live: cache hit, replaying logs
a0c4c59f57dce625 test:e2e:live: test:e2e:live: > @pmelab/gtd@27.6.0
test:e2e:live test:e2e:live: > vitest run --project e2e-live
--no-file-parallelism test:e2e:live: test:e2e:live: (node:34280) Warning:
Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS
connections and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:e2e:live: Generating a 2048 bit RSA private key test:e2e:live:
........................+++++ test:e2e:live:
.......................................................................+++++
test:e2e:live: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-test-6rXe81/key.pem'
test:e2e:live: ----- test:e2e:live: (node:48668) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:unit: cache miss, executing aa6cd1100eafc0fb test:unit:
test:unit: > @pmelab/gtd@27.6.0 test:unit test:unit: > vitest run --project unit
test:unit: test:unit: fatal: path 'missing.txt' does not exist in 'HEAD'
test:unit: fatal: invalid object name 'HEAD'. test:unit: warning: adding
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
private key test:unit: ..................+++++ test:unit: .+++++ test:unit:
writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-6ZpZFv/key.pem'
test:unit: ----- test:unit: Finished in 65ms on 1 files using 10 threads.
test:unit: Finished in 75ms on 1 files using 10 threads. test:unit: Finished in
61ms on 1 files using 10 threads. test:unit: (node:94663) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-I1hTYO
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two test:unit: test:unit:
FAIL this repository's config > loads, running the shipped workflows test:unit:
expected [ 'cleanup', 'feature', 'fix', …(2) ] to deeply equal [ 'feature',
'fix', 'review' ] test:unit: AssertionError: expected [ 'cleanup', 'feature',
'fix', …(2) ] to deeply equal [ 'feature', 'fix', 'review' ] test:unit:
test:unit: 1 test(s) failed test:unit: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/)
/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/node_modules/.bin/npm run
test:unit exited (1)

Tasks: 5 successful, 6 total Cached: 5 cached, 6 total Time: 1m10.977s Failed:
//#test:unit

ERROR run failed: command exited (1) test-states: risk_tier on — FAIL • turbo
2.10.9

• Running test:unit, test:workflows, test:e2e:inmem, test:e2e:live, test:web •
Remote caching disabled, using shared worktree cache

build: cache hit, replaying logs fab54aad2050b2e8 build: build: >
@pmelab/gtd@27.6.0 build build: > tsdown --filter web && npx @tailwindcss/cli -i
src/web/styles.css -o dist/web/main.css --minify && node
scripts/inline-web-client.mjs && tsdown --filter gtd && tsdown --filter
workflows && tsdown --filter entrypoints build: build: [34mℹ[39m [34mtsdown
v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m
config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
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
[34munist-util-stringify-position[39m test:web: cache hit, replaying logs
1d3f8b6d30c8c3e3 build: - [34mmdast-util-from-markdown[39m build: -
[34mccount[39m build: - [34mdevlop[39m build: - [34mescape-string-regexp[39m
build: - [34munist-util-is[39m build: - [34munist-util-visit-parents[39m
build: - [34mmdast-util-find-and-replace[39m build: -
[34mmdast-util-gfm-autolink-literal[39m build: - [34mmdast-util-gfm-footnote[39m
build: - [34mmdast-util-gfm-strikethrough[39m build: -
[34mmdast-util-gfm-task-list-item[39m build: -
[34mmicromark-extension-gfm-autolink-literal[39m build: -
[34mmicromark-extension-gfm-footnote[39m build: -
[34mmicromark-extension-gfm-strikethrough[39m build: -
[34mmicromark-extension-gfm-task-list-item[39m build: - [34mzustand[39m build:
[34mℹ[39m [38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.26
MB[22m build: [34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.26 MB
build: [32m✔[39m [38;2;100;116;180m[web][39m Build complete in [32m241ms[39m
build: ≈ tailwindcss v4.3.3 test:web: test:web: > @pmelab/gtd@27.6.0 test:web
test:web: > vitest run --project storybook test:web: build: build: Done in 69ms
build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown
v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
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
[2mdist/[22m[1mgtd.bundle.mjs[22m [2m3.37 MB[22m build: [34mℹ[39m
[38;2;155;180;100m[gtd][39m 1 files, total: 3.37 MB build: [32m✔[39m
[38;2;155;180;100m[gtd][39m Build complete in [32m201ms[39m build: [34mℹ[39m
[34mtsdown v0.22.8[39m powered by [38;2;255;126;23mrolldown v1.1.5[39m build:
[34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
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
in [32m88ms[39m build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m build: [34mℹ[39m config file:
[4m/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/tsdown.config.ts[24m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m entry:
[38;2;180;171;100msrc/flows/index.ts, src/wire/index.ts, src/steering/index.ts,
src/workflow-kit/index.ts, src/workflows/feature/index.ts,
src/workflows/review/index.ts, src/workflows/fix/index.ts,
src/workflows/rollout/index.ts, src/workflows/cleanup/index.ts,
src/testkit/index.ts[39m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
target: [38;2;180;171;100mnode20[39m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m tsconfig:
[38;2;180;171;100mtsconfig.json[39m build: [34mℹ[39m Build start build:
[34mℹ[39m Cleaning 19 files build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
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
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mtestkit.mjs[22m [2m585.19
kB[22m [2m│ gzip: 158.10 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/feature.mjs[22m [2m
27.99 kB[22m [2m│ gzip: 9.43 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mflows.mjs[22m [2m 27.72
kB[22m [2m│ gzip: 9.35 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflow-kit.mjs[22m [2m
11.89 kB[22m [2m│ gzip: 4.32 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/cleanup.mjs[22m [2m
2.19 kB[22m [2m│ gzip: 1.00 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/fix.mjs[22m [2m
2.08 kB[22m [2m│ gzip: 0.94 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/rollout.mjs[22m [2m
1.95 kB[22m [2m│ gzip: 0.89 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mworkflows/review.mjs[22m [2m
1.13 kB[22m [2m│ gzip: 0.60 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1msteering.mjs[22m [2m 1.05
kB[22m [2m│ gzip: 0.42 kB[22m build: [34mℹ[39m
[38;2;180;171;100m[entrypoints][39m [2mdist/[22m[1mwire.mjs[22m [2m 1.03 kB[22m
[2m│ gzip: 0.46 kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/Schema-DO5ttJaI.mjs [2m778.68 kB[22m [2m│ gzip: 167.57 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/steering-DVILanVf.mjs [2m437.58 kB[22m [2m│ gzip: 105.05
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/reserved-Df8GeSHw.mjs [2m 74.47 kB[22m [2m│ gzip: 24.68
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/wire-C12dahrH.mjs [2m 19.36 kB[22m [2m│ gzip: 7.62 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/registry-CP3YuV9j.mjs [2m 4.53 kB[22m [2m│ gzip: 1.87 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/tail-DmIfEAI4.mjs [2m 4.02 kB[22m [2m│ gzip: 1.66 kB[22m
build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m
[2mdist/[22mchunks/rolldown-runtime-8H4AJuhK.mjs [2m 0.38 kB[22m [2m│ gzip: 0.27
kB[22m build: [34mℹ[39m [38;2;180;171;100m[entrypoints][39m 17 files, total:
1.98 MB build: [32m✔[39m [38;2;180;171;100m[entrypoints][39m Build complete in
[32m237ms[39m build: build: > @pmelab/gtd@27.6.0 postbuild build: > node
scripts/assert-no-test-doubles.mjs build: test:unit: cache miss, executing
523aa2346efe830c test:e2e:live: cache hit, replaying logs a080cc2cc896362b
test:e2e:live: test:e2e:live: > @pmelab/gtd@27.6.0 test:e2e:live
test:e2e:live: > vitest run --project e2e-live --no-file-parallelism
test:e2e:live: test:e2e:live: (node:38901) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:e2e:live: Generating a 2048 bit RSA private key test:e2e:live:
...............................................................+++++
test:e2e:live: ..+++++ test:e2e:live: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-test-xI47j3/key.pem'
test:e2e:live: ----- test:e2e:live: (node:53059) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification.
test:e2e:live: (Use `node --trace-warnings ...` to show where the warning was
created) test:e2e:inmem: cache hit, replaying logs 7a5cdebd355a3167
test:e2e:inmem: test:e2e:inmem: > @pmelab/gtd@27.6.0 test:e2e:inmem
test:e2e:inmem: > vitest run --project e2e-inmem test:e2e:inmem: test:workflows:
cache hit, replaying logs 7a49f38df6dc233c test:workflows: test:workflows: >
@pmelab/gtd@27.6.0 test:workflows test:workflows: > vitest run --project
workflows test:workflows: test:unit: test:unit: > @pmelab/gtd@27.6.0 test:unit
test:unit: > vitest run --project unit test:unit: test:unit: fatal: path
'missing.txt' does not exist in 'HEAD' test:unit: fatal: invalid object name
'HEAD'. test:unit: warning: adding embedded git repository: sub test:unit: hint:
You've added another git repository inside your current repository. test:unit:
hint: Clones of the outer repository will not contain the contents of test:unit:
hint: the embedded repository and will not know how to obtain it. test:unit:
hint: If you meant to add a submodule, use: test:unit: hint: test:unit: hint:
git submodule add <url> sub test:unit: hint: test:unit: hint: If you added this
path by mistake, you can remove it from the test:unit: hint: index with:
test:unit: hint: test:unit: hint: git rm --cached sub test:unit: hint:
test:unit: hint: See "git help submodule" for more information. test:unit: hint:
Disable this message with "git config set advice.addEmbeddedRepo false"
test:unit: Finished in 59ms on 1 files using 10 threads. test:unit: Finished in
45ms on 1 files using 10 threads. test:unit: Finished in 37ms on 1 files using
10 threads. test:unit: Generating a 2048 bit RSA private key test:unit:
.............................................................+++++ test:unit:
.+++++ test:unit: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-LwSnlL/key.pem'
test:unit: ----- test:unit: (node:85910) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-cGmRNX
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two test:unit: test:unit:
FAIL this repository's config > loads, running the shipped workflows test:unit:
expected [ 'cleanup', 'feature', 'fix', …(2) ] to deeply equal [ 'feature',
'fix', 'review' ] test:unit: AssertionError: expected [ 'cleanup', 'feature',
'fix', …(2) ] to deeply equal [ 'feature', 'fix', 'review' ] test:unit:
test:unit: 1 test(s) failed test:unit: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/)
/Users/pmelab/.herdr/worktrees/gtd/sdlc-355-dogfood/node_modules/.bin/npm run
test:unit exited (1)

Tasks: 5 successful, 6 total Cached: 5 cached, 6 total Time: 1m19.179s Failed:
//#test:unit

ERROR run failed: command exited (1) test-states: judge_sonnet on — FAIL

<!-- gtd check 1cb31a9 -->
