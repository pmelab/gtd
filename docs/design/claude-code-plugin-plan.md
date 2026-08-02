# Claude Code plugin plan ("git-things-done" in Claude Code + web)

An install-and-forget Claude Code plugin that turns any Claude Code session —
CLI, desktop, or web — into a full gtd loop driver: autonomous beats run
unattended, human gates become conversation (native question UI + push
notifications), and the protocol is hardened by hooks where the platform
supports them.

## Ground rules (apply to every work package)

- **Zero gtd-core changes.** `src/`, `bin/gtd`, and `skills/loop/` (being
  deleted in another PR) are untouched. Everything lives under `plugins/gtd/`
  plus the repo-root `.claude-plugin/marketplace.json` and docs/tests.
  `gtd next --json` already carries everything a driver needs (`state`, `actor`,
  `kind`, `content`, `model?`, `memory?`, `file?`, `mode?`, `edges` with
  per-edge `describe`), and the gate steering files (`qa`/`review` markdown) are
  directly readable — no new JSON surface required.
- **The skill drives; hooks harden.** Plugin hooks do NOT run on Claude Code web
  (plugins there are skills-only), so the loop protocol must live entirely in
  skills that work everywhere. Hooks add CLI/desktop-only enforcement (validate
  gate, commit guard), context injection, and desktop notifications. Hooks never
  run `gtd step` — exactly one component (the skill) owns advancing the machine,
  so the two layers can never double-step a turn.
- **Inert outside gtd repos.** Install-and-forget means every hook script's
  first act is a cheap guard: resolve the gtd binary (`node_modules/.bin/gtd`,
  then `gtd` on PATH) and check the repo is gtd-active (a `.gtd/` directory or a
  `.gtdrc*` at the repo root). Guard fails → exit 0 silently, no output, no
  JSON. Skills likewise only trigger on gtd-shaped requests.
- **The armed marker.** The driver skill "arms" the loop by writing
  `$(git rev-parse --git-dir)/gtd-claude-loop` (per-worktree, in the git dir,
  never the work tree — same placement convention as `bin/gtd`'s memory marker)
  and removes it when the loop halts at a gate or settles. Hooks enforce only
  while the marker exists.
- Follow AGENTS.md: cucumber scenarios for new tested behavior, composable
  generic Given steps, never run `npm run test:mutation`. Run `npm run format`
  on touched files; keep `npm test` green (WP5 owns the full suite run).

## Architecture recap

| gtd driver concept                                 | Plugin realization                                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| loop protocol (`next` → act → `validate` → `step`) | `skills/go/SKILL.md` (portable: CLI + web)                                                                                                                       |
| `"memory"` scope                                   | subagent per scope: same label → `SendMessage` to tracked agent; change → fresh `Agent` (`agents/gtd-worker.md`)                                                 |
| `"model"` hint                                     | mapped onto the `Agent` call's `model` parameter                                                                                                                 |
| `"script"` beat                                    | Bash in the driving session (exit code ignored, then `gtd step <actor>`)                                                                                         |
| `"message"` gate                                   | `skills/gate/SKILL.md`: AskUserQuestion rendered from the steering file + `edges[].describe`, answer transcribed into the file, `gtd validate`, `gtd step human` |
| notifications at gates                             | web: PushNotification tool (skill-driven); CLI: Stop-hook desktop notify (osascript/notify-send)                                                                 |
| protocol enforcement                               | Stop hook (validate-or-block, keep-going-or-block while armed), PreToolUse hook (deny agent-authored `git commit/rebase/reset` while armed)                      |
| ambient state                                      | SessionStart hook injects `gtd status`; `scripts/statusline.sh` for the status line (user opt-in)                                                                |

## Layout

```
.claude-plugin/marketplace.json      # repo root: advertises the plugin
plugins/gtd/
  .claude-plugin/plugin.json         # manifest (name: "gtd")
  README.md                          # install + what-you-get
  skills/
    go/SKILL.md                      # /gtd:go — the portable loop driver
    gate/SKILL.md                    # /gtd:gate — human-gate conversation UI
    setup/SKILL.md                   # /gtd:setup — statusline + permissions opt-ins
  agents/
    gtd-worker.md                    # subagent for "prompt" beats
  hooks/
    hooks.json
    scripts/lib.sh                   # shared guard: gtd binary + gtd-active + armed marker
    scripts/session-start.sh
    scripts/stop-gate.sh
    scripts/pre-tool-guard.sh
    scripts/notify.sh                # desktop notification helper
  scripts/
    statusline.sh
docs/claude-code-plugin.md           # user docs
tests/integration/features/claude-plugin.feature
```

Install: `/plugin marketplace add pmelab/gtd` then `/plugin install gtd@gtd`.

## Work packages

### WP1 — Scaffold + marketplace

- `.claude-plugin/marketplace.json` (name `gtd`, owner, one plugin entry with
  `source: "./plugins/gtd"`).
- `plugins/gtd/.claude-plugin/plugin.json` (name `gtd`, description, author,
  repository, license MIT, keywords; `hooks: "./hooks/hooks.json"`).
- `plugins/gtd/README.md`: install instructions, the two-layer architecture
  (skills everywhere, hooks CLI-only), commands overview.
- Empty structure is fine; later packages fill it.

### WP2 — The driver skill + worker agent

`skills/go/SKILL.md` (auto-triggers on "run gtd", "keep gtd going", "work
through the workflow", also `/gtd:go`). Restates the pinned loop protocol from
`docs/loop.md` (do NOT reference or copy `skills/loop/` — it is being deleted):

- Opening move: peek `gtd next --json`; at `"message"` with pending human edits,
  `gtd step human` once; a refusal halts with the message verbatim.
- Loop: dispatch on `kind`. `"script"` → run `content` via Bash (exit code
  ignored; long checks may use run_in_background), then `gtd step <actor>`; zero
  new commits at idle = settled (report + disarm + stop). `"prompt"` → dispatch
  to a **subagent** per the memory contract below, then the self-validation gate
  (`gtd validate`; on findings re-prompt the same subagent, cap 3), then
  `gtd step <actor>` (with `--cost`/`--model` when the harness reported usage).
  `"message"` → disarm, then hand off to the gate skill (`/gtd:gate`).
- Memory contract: track `{memory label → agent id}` of the last prompt beat.
  Same label → `SendMessage` to that agent (context continues); different/
  absent label → fresh `Agent` call. Map the beat's `model` hint onto the Agent
  `model` parameter when it names a known tier, else ignore it. The worker gets
  ONLY the beat's `content` as its task (plus the standing rule below).
- Arm/disarm: write the armed marker before the first beat, remove it on
  gate/settle/stall. (On web the marker is written too — harmless, nothing reads
  it.)
- Stall detection: same state+content with no new commit since the previous
  prompt beat → halt, report, disarm.
- Never run bare `gtd`/`gtd loop` (that spawns a competing driver); only
  `next`/`step`/`validate`/`status`.

`agents/gtd-worker.md`: description ("executes one gtd workflow beat"), standing
rules: act exactly on the prompt given, never run `gtd step` (the driver owns
it), never `git commit`, run `gtd validate` before finishing if the beat named a
steering file, return a short summary of what changed.

### WP3 — Gate UI + push notifications

`skills/gate/SKILL.md` (auto-triggers when a session finds the machine at a
`"message"` rest, and via `/gtd:gate`):

- Read `gtd next --json`: the rendered gate `content`, the `file`/`mode` pair,
  and `edges[].describe` (the routing options in the workflow author's own
  words).
- Render the gate as **AskUserQuestion**: `qa` file → one question per open
  question (options from context, always leaving free-form); `review` file →
  approve-all vs. per-chunk feedback; plain `prose`/no-file gates → the
  `describe` strings as options. Show the underlying diff first when a review
  window is open (`git status`/`git diff` — the window surfaces the reviewable
  diff as uncommitted changes).
- Transcribe the user's answers INTO the steering file exactly per its format
  (tick boxes, write answers under questions, add feedback comments) — the human
  authored the decision, chat is the input device; the file stays the durable
  record. Then `gtd validate` (fix formatting findings), then `gtd step human`,
  then resume the loop via the driver skill.
- Offer `gtd abandon` as an explicit escape hatch when the user wants out.
- **Push notifications (web/remote):** on reaching a gate in a remote/web
  session, send a push notification (PushNotification tool via ToolSearch, when
  available) summarizing the gate and what's being asked; then end the turn.
  Never notify twice for the same unchanged gate.

`skills/setup/SKILL.md` (`/gtd:setup`, manual-only): offers to (a) install
`scripts/statusline.sh` into project `.claude/settings.json` `statusLine`, (b)
add permission allowlist entries for `gtd next/step/status/validate` and the
repo's test command so the loop runs unattended, (c) verify gtd is installed.
Each step asks before writing.

### WP4 — Hooks (CLI hardening, ambient state, desktop notifications)

`hooks/hooks.json` + `hooks/scripts/*.sh` (bash + jq, matching `bin/gtd`'s
dependency set; every script sources `lib.sh` and exits 0 silently unless
gtd-active):

- **SessionStart** (`startup|resume`): emit
  `hookSpecificOutput.additionalContext` summarizing `gtd status --json` (state,
  actor, pending matches) and, at a `"message"` rest, a pointer to run
  `/gtd:gate`; at an autonomous rest, a pointer to `/gtd:go`.
- **Stop** (`stop-gate.sh`, generous `timeout`): only while the armed marker
  exists. Run `gtd validate`; on findings → block
  (`hookSpecificOutput.decision: "block"`, findings as `reason`). Else
  `gtd next --json`: kind `"prompt"`/`"script"` → block with reason "the loop is
  armed and the machine still awaits <actor> at <state>; continue with the next
  beat or disarm by removing <marker>"; kind `"message"` or settled → allow,
  fire `notify.sh` (desktop notification: osascript on darwin, notify-send on
  linux, silent no-op otherwise) with the gate summary. Respect
  `stop_hook_active`/`stop_consecutive_count` vs `stop_hook_block_cap` from
  stdin: nearing the cap → allow with a `systemMessage` instead of looping
  forever.
- **PreToolUse** (matcher `Bash`): while armed, deny
  (`permissionDecision: "deny"`) commands matching
  `git commit|git rebase|git merge|git reset` (gtd owns history during a
  process; the reason says so and names `gtd step`). Everything else: no
  decision (exit 0, no JSON).
- `scripts/statusline.sh`: one line from `gtd status --json` (e.g.
  `gtd: building ⇦ agent (2 pending)`), empty output when not gtd-active.

### WP5 — Tests + docs

- `tests/integration/features/claude-plugin.feature` — cucumber (follow
  `gtd-loop.feature`'s @live style and the composable-Given conventions): hook
  scripts are plain bash taking JSON on stdin, so scenarios can exercise them
  directly with `GTD_BIN` pointed at the dev build: inert outside a gtd-active
  repo (no output, exit 0); Stop hook blocks with findings on a malformed
  steering file while armed; Stop hook allows + notifies at a message rest;
  PreToolUse denies `git commit` while armed and stays silent when disarmed;
  statusline renders the resolved state.
- Manifest sanity: a small unit test (vitest) that parses
  `marketplace.json`/`plugin.json`/`hooks.json` and asserts the paths they
  reference exist.
- `docs/claude-code-plugin.md`: install, architecture (skill drives / hooks
  harden / web = skills only), the gate conversation flow, notifications,
  statusline, permissions, troubleshooting (jq required for hooks, disarm by
  deleting the marker). Link from README.md's ecosystem/docs section and add a
  one-paragraph pointer in AGENTS.md's architecture notes so future engine
  changes know the plugin exists and what it depends on (`gtd next --json` field
  shape, `qa`/`review` file formats).

## Sequencing

WP1 → WP2 → WP3 → WP4 → WP5, one commit each. WP2/WP3 are the product on web;
WP4 is additive hardening; WP5 locks the contracts down.
