> @pmelab/gtd@10.5.0 test turbo run format:check typecheck lint lint:sh
> test:unit test:e2e:inmem test:e2e:live test:web deadcode

• turbo 2.10.9

• Running format:check, typecheck, lint, lint:sh, test:unit, test:e2e:inmem,
test:e2e:live, test:web, deadcode • Remote caching disabled, using shared
worktree cache

format:check: cache miss, executing 2ff48c26028489b1 typecheck: cache miss,
executing 08d210f22800d2cf lint: cache miss, executing a75f8b92696b5944
test:web: cache miss, executing 70879b64b8042519 deadcode: cache miss, executing
b5f7dd0bd1f76ba7 lint:sh: cache miss, executing 25f1e5683c969e51 build: cache
miss, executing 2bd0efccf35dab1a lint: lint: > @pmelab/gtd@10.5.0 lint lint: >
oxlint . lint: deadcode: deadcode: > @pmelab/gtd@10.5.0 deadcode deadcode: >
fallow --summary --quiet deadcode: typecheck: typecheck: > @pmelab/gtd@10.5.0
typecheck typecheck: > tsc --noEmit && tsc --noEmit -p src/web/tsconfig.json
typecheck: format:check: format:check: > @pmelab/gtd@10.5.0 format:check
format:check: > oxfmt --check . format:check: build: build: > @pmelab/gtd@10.5.0
build build: > tsdown --filter web && npx @tailwindcss/cli -i src/web/styles.css
-o dist/web/main.css --minify && node scripts/inline-web-client.mjs && tsdown
--filter gtd build: test:web: test:web: > @pmelab/gtd@10.5.0 test:web
test:web: > vitest run --project storybook test:web: lint:sh: lint:sh: >
@pmelab/gtd@10.5.0 lint:sh lint:sh: > jiti scripts/generate-shell-corpus.ts
--check && shellcheck -s sh tests/shell/corpus/*.sh lint:sh: lint: lint: !
react-hooks(exhaustive-deps): React Hook useEffect has a missing dependency:
'runCommitFreeText' lint: ,-[src/web/screens/Question.tsx:390:6] lint: 386 |
clearDebounceTimer() lint: 387 | runCommitFreeText() lint: : ^^^^^^^^|^^^^^^^^
lint: :
`-- useEffect uses `runCommitFreeText`here lint:  388 |       } lint:  389 |     } lint:  390 |   }, []) lint:      :      ^^ lint:  391 |  lint:     `----
lint: help: Either include it or remove the dependency array. lint: lint: !
react-hooks(exhaustive-deps): React Hook useEffect has a missing dependency:
'runAutoSave' lint: ,-[src/web/NoteSheet.tsx:126:6] lint: 122 |
clearDebounceTimer() lint: 123 | runAutoSave() lint: : ^^^^^|^^^^^ lint: :
`-- useEffect uses `runAutoSave`here lint:  124 |       } lint:  125 |     } lint:  126 |   }, []) lint:      :      ^^ lint:  127 |  lint:     `----
lint: help: Either include it or remove the dependency array. lint: lint: Found
2 warnings and 0 errors. lint: Finished in 50ms on 212 files with 116 rules
using 10 threads. build: [34mℹ[39m [34mtsdown v0.22.8[39m powered by
[38;2;255;126;23mrolldown v1.1.5[39m format:check: Checking formatting...
format:check: build: [34mℹ[39m config file:
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
[38;2;100;116;180m[web][39m [2mdist/web/[22m[1mmain.js[22m [2m1.16 MB[22m build:
[34mℹ[39m [38;2;100;116;180m[web][39m 1 files, total: 1.16 MB build: [32m✔[39m
[38;2;100;116;180m[web][39m Build complete in [32m258ms[39m deadcode:
Duplication Summary deadcode: deadcode: 6 Clone families deadcode: 10 Clone
groups deadcode: 2,155 Duplicated lines deadcode: 6.5% Duplication rate
deadcode: Health Summary deadcode: deadcode: 6133 Functions analyzed deadcode: 1
Above threshold deadcode: 91.5 Average maintainability (good) deadcode: ERROR
command (/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/)
/Users/pmelab/.herdr/worktrees/gtd/feat-phone-web-ui/node_modules/.bin/npm run
deadcode exited (1)

Tasks: 1 successful, 7 total Cached: 0 cached, 7 total Time: 1.747s Failed:
//#deadcode

ERROR run failed: command exited (1)

<!-- gtd check 68ecf7da -->
