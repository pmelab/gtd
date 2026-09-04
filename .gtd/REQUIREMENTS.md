Build a phone-first web interface for gtd, shipped inside this repository as a
new `gtd serve` surface, that triages every worktree on the machine, lets a
human contribute their turn — answer questions, annotate prose, check off review
hunks, dictate free text — and hands the turn back, driving the loop until it
rests at a human step again.

The design was charted decision by decision on the issue tracker; the map is
[Phone-first web UI for gtd](https://github.com/pmelab/gtd/issues/210) and every
concern below links the ticket holding its reasoning. Two working prototypes,
tested on a real phone, back the UI concerns:
`~/Code/gtd-prototypes/hunk-review-390.html` and
`~/Code/gtd-prototypes/plan-answer-390.html`.

**The UI introduces no new domain concepts.** Every input it offers is already a
markdown edit to the resting state's steering file, and every read is already a
field on `gtd next --json`. A fleet row is a **worktree**, not a process.

**Risk, blunt**: the server drives no beats. It spawns a configured loop command
and waits — deliberately, so this repository does not grow a second driver
implementation. The cost of that choice is legibility: a failure landing your
own edit surfaces in loop output rather than as a specific error on the phone,
and concern 6 is where that bites.

## Concerns

### 1. `gtd serve`, its config key, and the HTTPS binding contract — TECHNICAL

A fourth top-level `.gtdrc` key, `serve:` (roots, port, host, certificate paths,
loop command template), with flags overriding and `schema.json` regenerated.
HTTPS is mandatory, not a flag: the Web Speech API is secure-context-only, so
plain http loses dictation silently. `--self-signed` generates a certificate
carrying the `serverAuth` extended key usage — iOS rejects one without it
outright. Binds to the Tailscale interface when present, otherwise refuses to
start unless `--host` is passed explicitly, because a server that reads and
writes working trees without authentication must never silently appear on the
LAN. Prints the URL and a QR code on start.

**Acceptance**: the exit-code table stays closed at five numbers — port in use,
missing certificate, and "no tailnet and no `--host`" all exit 1; a bad flag
exits 2. `docs/cli.md`'s `## Commands` block is a generated view under test, so
it lands in the same commit. See
[#219](https://github.com/pmelab/gtd/issues/219).

### 2. Worktree discovery and the fleet screen — PRODUCT

Scan the configured roots for directories containing a `.git` entry — a linked
worktree's `.git` is a file, which is how worktrees parked outside their repo
are found without `git worktree list`. Depth 4, skipping `node_modules`, dotted
directories and symlinks, rescanned on every request. Every worktree found is
listed, including ones with no gtd process. A worktree's URL identity is a short
hash of its absolute path.

Rows group into four buckets: **Wants you** (`!idle && actor: human`, plus every
`kind: stalled`), **Working**, **Broken** (spawn failed, unsupported version,
unparseable beat), and **Quiet** (`idle`), collapsed behind its count. A row is
repo + branch, the state's `label`, and how long it has rested. Wants-you sorts
oldest-first; other buckets newest-first. The wants-you count goes in the
document title.

**Acceptance**: `actor: human` alone must not put a worktree in Wants you — an
idle worktree reports `actor: human` too, so `idle` is load-bearing in the
predicate. A worktree with no gtd config returns `kind: message` and workflow
warnings on stderr; the warnings are not a failure. See
[#212](https://github.com/pmelab/gtd/issues/212) and
[#213](https://github.com/pmelab/gtd/issues/213).

### 3. The review screen — PRODUCT

A chunk list whose cards carry the chunk's prose, a check-all tick and a
chunk-level note, each drilling into a deck of that chunk's hunks — one hunk per
screen, syntax-highlighted diff of `base..HEAD` sliced to the pointed-at hunk,
controls in flow below the diff rather than floating over it. Approving the last
hunk returns to the chunk list.

**Acceptance**: `##` headings carry no checkbox in the review format, so a chunk
tick ticks all of that chunk's hunks — the only honest meaning available. A
chunk carrying a footnote keeps the round open even when every hunk in it is
ticked. See [#214](https://github.com/pmelab/gtd/issues/214).

### 4. The plan-and-answer screen and prose steering files — PRODUCT

The same two-level shape for `qa` documents: a question list with a "Read the
plan" row and an **Already answered** section below the open ones, drilling into
one question per screen. Prose-only steering files get the same treatment minus
the questions.

Answering is **radio**: a question is answered iff exactly one option is ticked,
and a ticked free-text option with empty text is unanswered. Prose comments
anchor **per paragraph, one note each**, via a full-width thin seam below the
paragraph — selection-based anchoring was built and rejected on a phone. The
"read the plan" confirmation is client-side state keyed on the file's content
hash, so any rewrite clears it; the format gains nothing for it.

**Acceptance**: a `##` section may not precede `## Open Questions`, and none may
follow `## Answered Questions`. See
[#222](https://github.com/pmelab/gtd/issues/222) and
[#223](https://github.com/pmelab/gtd/issues/223).

### 5. Writing into a live worktree — TECHNICAL

Editing is offered only when the worktree rests at a `human` state. Every tick
and every attached note writes through immediately, carrying a token of HEAD sha
plus a content hash of the steering file's bytes; the server re-reads both at
write time and writes only on a match. A mismatch rejects outright — no semantic
re-apply, no merge — and the input survives as a client-persisted draft with a
banner naming what changed. A background refresh replaces the screen only when
no draft exists.

**Acceptance**: the compare-and-swap is the only staleness guard there is.
Emitted scripts carry no expiry check, so a script must be generated and run
promptly and never queued. See [#215](https://github.com/pmelab/gtd/issues/215).

### 6. Handing the turn back, and running the loop — TECHNICAL

The done action writes the steering file, then spawns the **configured loop
command** with the worktree as cwd and waits for it to return. The server drives
no beats itself: a human's pending edit reaches the loop as an ordinary
`kind: capture` beat, which any driver lands like any other. The phone returns
to the fleet list, where the worktree sits in **Working** until the child exits.

Completion is "the child exited, now re-read `gtd next --json`" — the exit code
is ignored and the output is not parsed, because the beat document is the truth.
Any loop command in any language satisfies that contract. Failures show the
captured output and the exit code inline, since gtd exits 1 for every refusal
and the text is the only thing that distinguishes them.

**Acceptance**: the spawned command runs with a shim directory prepended to
`PATH` so `gtd` resolves to that worktree's own binary — a mode's seeded
validate command is literally `gtd check <mode> '<file>'`, invoked by name from
inside an emitted script. Everything else a driver owes gtd — agent dispatch,
sessions, `--cost`/`--model`, the self-validation fix loop and its retry cap,
the first-beat rule, reading `settled`/`idle` before piping — belongs to the
loop command, not here. See [#217](https://github.com/pmelab/gtd/issues/217) and
[#226](https://github.com/pmelab/gtd/issues/226).

### 7. Loop lifecycle — TECHNICAL

An in-memory registry of the server's own child processes; log-mtime freshness
as the only available signal for a foreign driver, and a worktree already being
driven is never double-driven. Stop sends `SIGINT` to the loop command,
escalating to `SIGKILL` after a timeout — the same signal Ctrl-C sends, which
gtd's exit-code table already covers at 130, giving the loop a chance to finish
its beat. A server restart kills the child and persists nothing: each worktree
reports its real rest, a dirty `prompt` rest reads as interrupted, and nothing
auto-resumes. Concurrency is unlimited by explicit decision.

**Acceptance**: session ids are derived, never stored, so a restart loses
nothing resumable — and they are the loop command's concern in any case.
Foreign-driver detection is imprecise by nature and must say so where it is
surfaced. See [#225](https://github.com/pmelab/gtd/issues/225).

### 8. The client, and how it is built and tested — TECHNICAL

React in TypeScript under `src/web/`, built by a second tsdown entry with
`platform: "browser"` and inlined into the single node bundle through the
`.html` text loader already configured; `gtd serve --dev` reads it off disk
instead. tRPC for client↔server, with refusals crossing as a typed error whose
payload carries `{stdout, stderr, exitCode}` intact. Server state in React
Query, drafts in `localStorage` keyed by worktree + file.

**Acceptance**: client code passes the same `typecheck`, `oxlint`, `oxfmt` and
`fallow` gates as the rest of `src/`. Storybook stories run as vitest tests
under a new `test:web` task, which needs all three of a `package.json` script, a
`turbo.json` task with explicit `inputs`, and its name in the `test` script's
task list. tRPC's server half becomes the first runtime dependency this package
carries purely for the web surface. See
[#218](https://github.com/pmelab/gtd/issues/218).

### 9. Dictation — PRODUCT

A mic button using the Web Speech API on the free-text answer option and in the
note sheet, and nowhere else; the iOS keyboard's own dictation covers every
textarea for free. No server-side transcription. Dictated text writes through on
attach, never on interim results.

**Acceptance**: feature-detect and catch `not-allowed` — hide the mic, keep the
textarea, show a one-line hint naming the keyboard's mic key. The capability
research is [#216](https://github.com/pmelab/gtd/issues/216). See
[#220](https://github.com/pmelab/gtd/issues/220).
