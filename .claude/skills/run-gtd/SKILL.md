---
name: run-gtd
description:
  Test a gtd change by hand — build this checkout, start a process in a scratch
  repository, step it to the behaviour under test and observe it, with stand-ins
  for the agent, `gh` and the browser. Use when asked to manually test, really
  run, try out or prototype-test a gtd change or an acceptance criterion.
---

# Testing gtd by hand

The automated suites already ran. This is for using the change the way a person
would: run the real `gtd` from this checkout against a throwaway repository and
look at what it does.

## Rules

- **Never run gtd in this checkout.** It may host a live process: a `gtd land`
  here commits or reverts that process's work. Every command below runs in a
  scratch repository OUTSIDE this checkout.
- **Never export `GIT_DIR` or `GIT_WORK_TREE`.** gtd and its emitted scripts
  honour them, so the scratch run commits onto this checkout's branch instead.
- **Start from a clean env.**
  `env | cut -d= -f1 | grep -E '^(GIT_|GTD_|TYPESAFE_)'` should list nothing but
  `GIT_CONFIG_*` and what you set on purpose; unset the rest. An inherited
  `GTD_LOOP_LOG` moves the loop log, `GTD_<SETTING>` (for example
  `GTD_TESTCOMMAND`) overrides the workflow under test. Set on purpose:
  `GTD_FLAG_<NAME>=1` for a change behind a release flag, and
  `GTD_JUDGE_PROVIDER=fixed` with `GTD_JUDGE_ANSWERS` for a driver run.
- **Judge gates ask a real model** unless told otherwise: with no provider,
  `gtd judge run` uses TypeSafe (`TYPESAFE_API_KEY`), a `judge.json`, or else
  the real `claude` CLI. Always pass `--provider fixed`, or set
  `GTD_JUDGE_PROVIDER=fixed`, as below.
- **At most 2 driver runs or `npm test` runs at once** on this machine — more
  time out the `@live` scenarios.
- **Never run `npm run test:mutation`.** It is a deliberate user action.
- **Never print env values** — inspect by name only, as above.

## Build

```bash
npm run build                 # after every source change
export PATH="$PWD/bin:$PATH"  # this checkout's gtd, first on PATH
command -v gtd                # must print this checkout's bin/gtd
```

`bin/gtd` runs this checkout's `dist/`. The `gtd` already on `PATH` may be
another checkout's build. Emitted scripts and steering validation call `gtd`
from `PATH`, so putting `bin/` first is required, not a convenience.

## A scratch repository

```bash
repo="$(mktemp -d)" && cd "$repo"
git init -q -b main
cat > gtd.config.ts <<'EOF'
import { feature } from "@pmelab/gtd/workflows"

export { summary, steering, skills, access } from "@pmelab/gtd/workflows"

export default feature({ testCommand: "true" })
EOF
git add -A && git commit -qm "chore: initial commit"
```

- **No install needed.** gtd resolves `@pmelab/gtd/*` imports to its own copy,
  so the config runs this checkout's workflows.
- **`testCommand`** is what every check runs. `true` keeps the baseline green;
  use a real script (`sh test.sh`) when the behaviour under test depends on red
  checks. The default, `npm test`, is red in a repository with no
  `package.json`.
- **A different workflow:** export it, e.g.
  `export { review } from "@pmelab/gtd/workflows"`, and start it with
  `gtd --workflow review | sh` (review needs a branch with commits beyond
  `main`). `gtd install`, run before the config exists, writes the full shipped
  one instead.
- **A fake `origin`** where pushing or a base branch matters:
  `git init -q --bare "$repo.git" && git remote add origin "$repo.git" && git push -q -u origin main`.

## Driving a process

Two commands make the cycle: `gtd next` says whose turn it is, `gtd land`
records it. Read `gtd next --json=kind`:

| `kind`    | What to do                                                                    |
| --------- | ----------------------------------------------------------------------------- |
| `capture` | a human edit is pending — land it                                             |
| `script`  | a check: `sh -c "$(gtd next --json=content)"`, then land, whatever it exits   |
| `prompt`  | an agent turn: do what `gtd next` prints (below), then land                   |
| `message` | a human rest: read `gtd next`, answer by editing its steering file, then land |
| `message` | with `gtd next --json=judge` non-empty, a judge gate: answer it (below)       |
| `stalled` | the process is stuck: `gtd next --json=content` says why                      |

Land with `gtd land --json=script | sh` (plain `gtd land` only says what it
would commit). The pipe hides a refused landing — `sh` runs an empty script and
exits 0 — so read `gtd land`'s stderr, or capture the script first as the worked
example does. `gtd next --json` shows the whole state: `state`, `file`,
`access.write`, `validate`. `git log --oneline` is the process's history.

To run many beats at once, save the minimal driver from `docs/driver.md` ("A
complete minimal driver") and run it in the scratch repository with a `claude`
stand-in on `PATH` (below). It stops at the first human rest.

Answer a judge gate with a verdict you choose, one `{ id, answer, p }` per
question `gtd judge --json` lists, written OUTSIDE the scratch repository (a
file inside it is committed with the answer):

```bash
gtd judge --json | gtd judge run --provider fixed --answers="$repo.verdict.json" |
  gtd judge answer --json=script | sh
```

Answer a human rest as a person would: tick a box, write a footnote, edit code —
then land. Changing nothing and landing accepts a gate that allows it.

## Stand-ins for external tools

No run needs the network or a model, with judge gates on `--provider fixed`.

**An agent turn, by hand.** Read the prompt (`gtd next`), write only the files
`gtd next --json=access.write` allows, run the step's validator, land:

```bash
gtd next | less                          # the prompt the agent would get
$EDITOR .gtd/REQUIREMENTS.md             # the turn's work
sh -c "$(gtd next --json=validate)"      # silent when the file is well-formed
gtd land --json=script | sh
```

**An agent turn, scripted** for the minimal driver: a `claude` on `PATH` that
reads the prompt on stdin, acts on it and prints a result envelope.

```bash
shims="$(mktemp -d)" && export PATH="$shims:$PATH"
cat > "$shims/claude" <<'EOF'
#!/bin/sh
prompt="$(cat)"
case "$prompt" in
  *"may write only: .gtd/REQUIREMENTS.md"*) cp "$HOME/fixtures/REQUIREMENTS.md" .gtd/ ;;
  *) echo "claude stand-in: unexpected prompt" >&2; exit 1 ;;
esac
echo '{"type":"result","is_error":false,"total_cost_usd":0}'
EOF
chmod +x "$shims/claude"
```

**`gh`.** The gtd Claude Code mod opens and edits pull requests through `gh`. A
shim records every call, and the body `--body-file -` sends on stdin, and
answers with canned output:

```bash
cat > "$shims/gh" <<'EOF'
#!/bin/sh
log="$(dirname "$0")/gh-calls.log"
echo "gh $*" >>"$log"
case " $* " in *" --body-file - "*) cat >>"$log" ;; esac
case "$1 $2" in
  "pr view") echo "no pull requests found for branch" >&2; exit 1 ;;
  "pr create") echo "https://github.com/example/repo/pull/1" ;;
  *) echo '{}' ;;
esac
EOF
chmod +x "$shims/gh"
```

Then read `$shims/gh-calls.log` to check what would have been sent.

## The web UI

`gtd ui` serves a phone client for the repository it runs in. It refuses while
the process rests with an agent or a check, so step to a human rest first.

```bash
gtd ui --host 127.0.0.1 --self-signed   # prints the URL; Ctrl-C stops it (exit 130)
```

`--host` skips `tailscale serve`; `--self-signed` needs no certificate. From
this checkout (Playwright is a dev dependency), capture the screen at a phone
size — into a path outside both repositories:

```bash
npx playwright screenshot --ignore-https-errors --wait-for-timeout 2000 \
  --viewport-size 390,844 "https://127.0.0.1:<port>/" "$repo.png"
```

To click and type, drive the same URL with Playwright (or the `playwright-cli`
skill) with HTTPS errors ignored, then check the steering file and
`gtd next --json=state` changed as expected.

## Worked example

Start a feature process, stand in for the triage agent, rest at the product
gate, answer it and land. Run it with `bin/` first on `PATH`, as in
[Build](#build); it cleans up its scratch repository on exit.

```bash
#!/usr/bin/env sh
set -eu

repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
cd "$repo"
git init -q -b main
cat >gtd.config.ts <<'EOF'
import { feature } from "@pmelab/gtd/workflows"

export { summary, steering, skills, access } from "@pmelab/gtd/workflows"

export default feature({ testCommand: "true" })
EOF
git add -A
git commit -qm "chore: initial commit"

# Capture the landing script first: piped straight into `sh`, a refused
# landing would run an empty script and exit 0.
land() {
  script="$(gtd land --json=script)"
  printf '%s\n' "$script" | sh
}

# Start: a sketch is a human edit, and landing it starts the process.
mkdir -p .gtd
echo "Add hello.sh that prints hello." >.gtd/TODO.md
land

# Checks run until the first agent turn.
while [ "$(gtd next --json=kind)" = script ]; do
  sh -c "$(gtd next --json=content)" >/dev/null 2>&1 || true
  land
done
test "$(gtd next --json=state)" = design.triage

# Stand in for the triage agent: one open product question.
cat >.gtd/REQUIREMENTS.md <<'EOF'
## Open Questions

### What should hello.sh print?

The greeting is user-visible.

- [ ] `hello`
  - matches the sketch
- [ ] `Hello, world!`
  - the classic
- [ ] _your answer_

## Concerns

1. PRODUCT: add `hello.sh`, printing a greeting.

## Acceptance Criteria

- AC-1: `sh hello.sh` prints the chosen greeting.
EOF
sh -c "$(gtd next --json=validate)"
land

# A human rest: read it, answer by editing the steering file, land.
test "$(gtd next --json=kind)" = message
gtd next
sed 's/^- \[ \] `hello`$/- [x] `hello`/' .gtd/REQUIREMENTS.md >"$repo.tmp"
mv "$repo.tmp" .gtd/REQUIREMENTS.md
land
test "$(gtd next --json=state)" = design.triage
git log --oneline
```
