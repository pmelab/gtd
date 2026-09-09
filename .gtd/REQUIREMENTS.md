# Requirements

## Open Questions

### What is `gtd ui`'s security boundary — a tightened bind guard, or a token?

There is no authentication of any kind, and none was removed: no token, no
header, no cookie, no `Origin` check, no rate limit. The comment above
`resolveBindHost` (`src/ui/Server.ts#69`) says the refusal exists because "a
server that reads and writes working trees without authentication must never
silently appear on the LAN" — and that is untrue as written, because the guard
fires only when `--host`, `ui.host` and the Tailscale scan all come up empty. A
supplied host is never validated, so `--host 0.0.0.0` or `ui.host: "0.0.0.0"`
binds every interface unauthenticated. The two answers below diverge in what a
user must do to reach the phone at all, so this cannot be settled downstream.

- [ ] the bind guard becomes the whole boundary — refuse any host that is not
      loopback or a CGNAT (100.64.0.0/10) tailnet address, which makes the
      existing comment true and keeps the URL in the QR code plain
- [ ] keep honouring any explicit `--host`/`ui.host` as the user's consent, and
      add a single-use token to the URL the QR encodes, checked on every tRPC
      call and on `/close`
- [x] nothing. it is only available within the tailnet. thats the boundary.

## 1. Gate `gtd ui` on a human rest, not on the beat's content kind

PRODUCT. `gtd ui` refuses to start on both steps it exists for, and starts only
on steps no human sits at. The gate is on the wrong axis.

`isRenderable` (`src/ui/Server.ts#287`) admits a step only when its content kind
is `prompt`. Seven states in `src/workflows/unified.yaml` carry a `mode:`. The
two with `actor: human` — `build.review.await-review` (line 767, `mode: review`)
and the QA `answer` gate (line 390, `mode: qa`) — both declare `message:`, so
the beat reports kind `message` and the gate rejects them. The remaining five
are `actor: agent` or `actor: check`: `design.triage` (423),
`architecture.author` (568), `build.review.reviewing` (712),
`build.review.deciding` (813), `build.review.collecting` (913). Those are the
only steps `gtd ui` will bind on today.

Verified live on this worktree resting at `build.review.await-review`: `gtd ui`
exits with "refuses to start — 'Awaiting your review' rests at message, which
has no phone screen".

The command exists to facilitate the steps where a HUMAN feeds a steering file.
Gate on that: a rest whose actor is human and whose `file` and `mode` resolve to
a registered steering format.

**The write path already gates on exactly that axis** — `writeNote` and
`writeValue` re-check `actorAt` per write and refuse `agent`, `check` and
`undefined` (`src/ui/Write.test.ts#147`, `#335`). So today's startup gate and
write gate contradict each other: every rest the server will start on is a rest
it will then refuse every write at. Aligning the two is the whole change.

**Content kind is the wrong axis regardless of which kinds are listed.** A
`message` state's kind shifts to `capture` the moment the human dirties the
tree, so a kind-based test is unstable under the very editing the UI invites.

`idle` stays load-bearing in the new predicate: an idle worktree reports
`actor: human` too — `ui.feature#43`'s own fixture declares its `idle` state
`actor: human` — so an actor-only test would start on a finished worktree. A
`broken` (unreadable) worktree keeps refusing.

The startup gate is checked once, so it shares one defect with the mid-flight
staleness already recorded in the review: the server's view of the rest is a
snapshot, and when the outer loop advances state while the server is up, `step`
reports the new rest to a client with no screen for it. Both sides of that
defect belong to this concern.

Fold in the one cleanup in the same code: `refusalFor` (`src/ui/Server.ts#302`)
hand-writes `Step | { status: "broken" ... }` where the union is already
`StepRead`.

**Acceptance**: a new e2e scenario resting at a human state that carries a
`file` and a registered `mode` — the shape of `await-review` — binds a port and
exits 0; it fails today with exit 2. All eight `ui.feature` refusal scenarios
still refuse after the change, because not one of them sets up a human rest
carrying a `mode` — but their asserted stderr moves off the content kind
("message", "capture", "script", "stalled") and onto the actor, so every one of
them is edited, not deleted. The exit-code set stays closed at five numbers.

## 2. Every refusal reaches the human, and no screen is ever blank

PRODUCT. **Every write refusal is now invisible.** The `doneRefused` banners are
deleted from both screens, `onDoneNote` swallows every error
(`.catch(() => {})`, `src/web/screens/Plan.tsx#497`), and
`onSetValue`/`commitAnchor` catch and silently revert. A `stale-token` on a tick
makes the checkbox flick back with **zero explanation**. This is a regression
against the base commit, which showed one banner.

`writeRefusalFrom` and `WriteRefusalInfo` (`src/web/api.ts#33`) survive and name
exactly the six refusal reasons, with **no caller anywhere in `src/web`** —
their only consumer was the deleted `drafts.ts`. Wire them to a banner, or
delete them with their tests; `fallow` currently scores them live only through
`api.test.ts`.

**A blank white screen is the universal failure mode.** `src/web/App.tsx#28`
returns `null` for query-in-flight, query error, dead server and file-less step
alike — no spinner, no error surface, no `aria-busy`. First paint on a phone
over a tailnet is a blank page. `mode={step.mode ?? ""}` (`App.tsx#36`) forwards
an empty mode into `readSteeringFile` and every mutation, whose
`unsupported-mode` refusal then displays nothing.

Accessibility rides in the same work: `HandedBackPanel`
(`src/web/screens/Review.tsx#429`) is a bare `div` with no
`role="status"`/`aria-live`, so the one state change that matters most is
unannounced; the free-text textarea has a placeholder and no label; and
blur-to-commit has no saving/saved affordance, which on touch means blur is
invisible and the human cannot tell whether the answer landed.

Delete, do not move, the "why fallow scores this untested" paragraph now copied
into six files (`Deck.tsx#41`, `Mic`, `Plan` ×3, `Review` ×2, `Hunk`,
`Question`) — one shared note became six near-identical ones.

**Acceptance**: a story where `setValue` rejects with `stale-token` asserts a
visible, named reason on screen, and a story where `trpc.step` is in flight
asserts something other than an empty document. Both fail today.
`Question.stories.tsx` is untouched by the branch, so `onCommitAnswer` has no
coverage at its own layer; it gains it here.

## 3. Nothing the human types is silently lost, and a reload does not end the turn

PRODUCT. **`pagehide` fires on reload, not only on close — so pull-to-refresh on
the phone kills `gtd ui`.** `src/web/main.tsx#18` beacons `POST /close`, and
`/close` responds 204 and calls `endServer()` immediately with none of
`handOff`'s grace. The reload lands on a dead port and a blank page. On iOS
Safari, `visibilitychange`/`hidden` from an app switch or a screen lock is a
further false-positive candidate for the same beacon. Two stories claim the
opposite and prove only that a fresh React mount reads `checked` back off the
server — they mock away the very process a real reload has just terminated
(`Plan.stories.tsx#718`, `Review.stories.tsx#711`), so package 03's "survives a
page reload" acceptance is satisfied only against a mock.

**Free text is lost if the textarea is never blurred.**
`src/web/screens/Question.tsx#118` commits on blur only, and `NoteSheet.tsx#47`
holds note text in plain `useState` with no autosave at all. Tab close, screen
lock, or an unmount without a blur event discards it — and `drafts.ts`, the
local persistence layer, is deleted. Combined with the beacon, one mis-tap on
refresh discards in-flight typing **and** ends the session.

**An answer cannot be cleared.** `Question.tsx#264` returns early on empty text,
so deleting a previously written free-text answer and blurring leaves the old
text on disk while the UI shows an empty textarea — silent divergence. The guard
is right for a mis-tap and wrong for a deliberate erase, and no gesture
distinguishes them today.

**Revert-on-rejection restores a stale snapshot.** `Question.tsx#247` captures
`previous` at call time and `Review.tsx#148` captures a `previous` Map; a slow
rejection restores it wholesale, clobbering anything the human did in the
interim. Tick A, tick B, A's write fails, B's tick vanishes too — realistic on a
flaky tailnet.

**Acceptance**: a real-process `ui-lifecycle` scenario that reloads the page and
then completes a hand-off — the server is still alive and exits 0 through
`done`, not through the beacon. Plus the positive free-text path as a story —
type, blur, exactly one `setValue` carrying `checked` and `text` together —
which has no coverage anywhere despite being package 03's stated acceptance. The
beacon is registered at module top level in `main.tsx` and so is not injectable;
it moves behind something a story can drive.

## 4. Shell safety and confinement inside the served worktree

TECHNICAL. Four holes, all reachable without authentication, all in code this
branch shipped or left standing.

**A cloned repo's own `.gtdrc` executes shell on first run.** `src/ui/Tls.ts#52`
interpolates `host` into `-subj "/CN=${request.host}"` and the `subjectAltName`
line, handed as a string to `runner.bash`. `host` comes from `--host` **or
`ui.host` in the repo's own `.gtdrc`**, so `ui.host: "$(...)"` runs on the first
`gtd ui --self-signed`. Escape it, or hand `openssl` an argv array.
`src/ui/Diff.ts#172` has the same shape and is pre-existing: `quotedPath` is
properly single-quote-escaped, but `base` is interpolated unquoted straight out
of `gtd base`'s stdout.

**The private key leaks on every failure path.** `src/ui/Tls.ts#87` removes the
tmpdir holding `key.pem` only on the success path. Mode 0700, so contained but
persistent.

**`resolveWithinRoot` does not resolve symlinks.** There is no `realpath`
anywhere in `src/ui/`. A symlink inside the worktree pointing outside it passes
every one of the four gates (`Write.ts#187`, `Write.ts#214`,
`ReadSteeringFile.ts#53`, `Diff.ts#158`); `readSteeringFile` then returns the
target's bytes and `writeNote` writes through it. Worktrees are agent-writable,
so the chain is plausible. The same check also refuses a legitimate name: a file
called `..foo` resolves to relative `..foo` and trips `startsWith("..")`.
Compare path segments, not the string prefix.

**Reads inside the root are unrestricted.** Nothing confines `filePath` to
`.gtd/` or to the step's own `step.file`, and `View.ts`'s dispatch is total over
content, so `readSteeringFile({filePath: ".git/config", mode: "qa"})` returns
raw bytes — arbitrary read of anything in the repo, `.env` included. Confine it
to the served step's file.

`--dev` (`src/ui/Server.ts#226`) shells `npx tsdown --filter web` **per HTTP
request**, so one unauthenticated request triggers a build in the gtd source
checkout.

**Risk, blunt**: deleting `BeatCache` removed the only throttle that ever
existed. Every `step` and every `writeNote` now spawns a fresh `gtd next --json`
— a ~0.5s bundle parse — with no cache and no concurrency cap, where the old
cache capped it at 8 live spawns. Request flooding is subprocess amplification.
One worktree makes that survivable, not correct, and this concern does not fix
it; whichever answer the open question takes decides whether it needs fixing.
`src/ui/Beat.ts#18`'s comment still points at the deleted cache and comes out
here.

**Acceptance**: a unit test with `ui.host` set to a command-substitution string
asserts no shell execution and a failed certificate request, and one with a
symlink inside the root pointing outside it asserts the read and the write both
refuse. Both pass a malicious value today.

## 5. Take the graft agent tooling off this branch

TECHNICAL. None of it belongs to `serve` → `ui`. It rode along on two step
commits.

`.claude/helpers/graft-hooks.cjs#7` and the near-identical 98-line
`.claude/helpers/graft-statusline.cjs#7` both hardcode
`BAKED = "/Users/pmelab/.local/share/mise/installs/npm-nanonets-graft/0.16.0/..."`
— a machine-local absolute path carrying the author's home directory and a
pinned install, committed to the repo. `.claude/settings.json#48` adds four
graft hooks (SessionStart, two PostToolUse, UserPromptSubmit, Stop) plus
`statusLine`, `subagentStatusLine` and `footerLinksRegexes` to **project**
settings, so it overrides every contributor's status line and runs graft on
their every prompt, edit and tool call; `#31` allowlists `Bash(graft:*)`,
`Bash(npx graft:*)`, `Bash(graft-dev:*)` and `Bash(node dist/cli.js:*)`, of
which `graft-dev:*` is a local dev alias and `node dist/cli.js:*` is broadly
permissive for a checked-in allowlist. `.mcp.json#1` registers a `graft` MCP
server via a bare `graft` command — a broken server entry for every contributor
who has not installed it. `.claude/skills/graft/SKILL.md#1` vendors a 172-line
third-party skill instructing agents to prefer graft over grep: an unreviewed
instruction surface for every agent that opens the repo. `.ignore#1`'s `!graft/`
re-admits the gitignored cards to ripgrep — a neat trick, and pointless unless
graft is adopted project-wide.

`mise.lock` is the one defensible file: a real reproducibility improvement
alongside the existing `mise.toml`. It is still unrelated to this branch and
belongs in its own commit.

**Risk, blunt**: removing these disables tooling the author uses in this
worktree right now. Take it off this branch, not out of existence — the
alternative is de-hardcoding the baked path and moving the hooks to user
settings, on a branch of their own.

**Acceptance**: `git diff <base>..HEAD --name-only` names no path under
`.claude/`, no `.mcp.json` and no `.ignore`; `npm test` is unaffected either
way, so this concern is the last one and blocks nothing.

## Answered Questions

### Should `gtd ui` still start on the five `agent`/`check` rests it admits today?

No. The review-round note calls starting only mid-agent-turn the defect itself,
and the write path already refuses every write at those rests, so a server bound
there can offer nothing but a read-only view nobody asked for.

### What does the server do when the rest changes while it is up?

It ends its own life, the same way `done` does. The branch's settled doctrine is
one step, one exit, with the outer loop reacting to the exit — so a rest that no
longer exists is the end of this server's job, not a screen to re-render.
