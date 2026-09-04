The phone UI is a **third consumer of a seam that already exists**. `gtd lsp`
and `gtd check` both read a steering file through `SteeringFormat` — validate,
outline, code actions, pointer jumps — and every mutation they perform is a
byte-range `SteeringEdit`, never a re-serialization. `gtd serve` reads the same
files the same way and writes them the same way. No markdown writer is added,
because `mdast-util-to-markdown` is deliberately not a dependency and a reflow
of a steering file is how the validator gets broken.

Every worktree's state is read by **spawning that worktree's own
`gtd next --json`**, never in-process. `next --json` is the whole read surface:
`kind`, `content`, `idle`, `state`, `actor`, `label`, `mode`, `file`, `log`,
`edges`, `changes`, `next`, plus `session`/`model`/`system`/`validate` at a
`prompt` rest. Note `settled` is **not** on `next` — it is a `gtd land --json`
field, and concern 6 already assigns it to the loop command.

**Risk, blunt, with the number**: one `gtd next --json` costs **520–660 ms** — a
10.36 MB bundle parse plus its git subprocesses. A 30-worktree fleet read is ~18
s serial, ~2.5 s at concurrency 8, and ~1–2 s unbounded at the price of 30
concurrent node processes. The fleet screen is the first thing the phone loads,
so this number is the product, not an implementation detail. It is open
question 3.

**Second risk**: `CommandRunner` cannot run the loop. It is bound to `Cwd.root`,
it **merges stdout into stderr** into one `output` string, and it has no signal
handling. Concern 6 requires `{stdout, stderr, exitCode}` intact and concern 7
requires SIGINT-then-SIGKILL. So `serve` adds a second process port, and
`CommandRunner`'s doc comment claiming to be "the only place gtd itself spawns a
subprocess" becomes false and must be amended in the same commit.

## Open Questions

### Does `SteeringFormat` grow view-and-annotate members, or does `src/serve/` adapt each built-in format by hand?

The server needs two things per format that the interface does not currently
expose: a domain view model (chunks with hunks; questions with options) and an
edit-producing annotate call (attach a footnote at an anchor). The parts exist
as module exports — `parseReviewDoc`, `parseOpenQuestions`, `toggleFilePointer`,
`toggleCheckbox` — but none of them is a `SteeringFormat` member, and footnote
_insertion_ does not exist at all in either module.

- [ ] Grow the interface — add a `view` and an `annotate` member to
      `SteeringFormat`, so the LSP and the web surface share one seam and a
      user-declared custom mode can light up the phone UI later.
      `SteeringFormat.ts` is a zero-import vocabulary file and stays one; it
      gains two union types. `SteeringFormats.test.ts` gets a universal
      assertion per registry entry, the same way `sample` is already forced
- [ ] Adapt by hand — `src/serve/` imports `ReviewDoc`/`OpenQuestions` directly
      and switches on `mode`, leaving the core interface untouched. Two bespoke
      adapters, no churn in a file the LSP depends on, and a third format needs
      a third adapter before the phone shows it anything
- [ ] _your answer_

### Does this repository gain a real Storybook, or only the story file format run through `composeStories` in a jsdom vitest project?

Concern 8 settles that "Storybook stories run as vitest tests under a new
`test:web` task". Both of these satisfy that sentence and they are not the same
build.

- [ ] Full Storybook — `@storybook/react-vite` plus the vitest addon and browser
      mode, which means a Playwright chromium download in CI; roughly 300 MB of
      devDependencies, and a browsable component catalog on a real phone, which
      is how both prototypes were validated in the first place
- [ ] Portable stories only — keep `*.stories.tsx` as the file format and run
      them via `@storybook/react`'s `composeStories` in a new jsdom vitest
      project; roughly 30 MB, no browser download, no `storybook dev`, and no
      way to open the catalog on the phone
- [ ] _your answer_

### Is each worktree's beat re-read on every fleet request, or memoized against HEAD sha plus steering-file mtime?

Concern 2 settles that the _directory scan_ is redone on every request. It does
not settle the N beat reads that follow, and those are the 520–660 ms each.

- [ ] Re-read every time, bounded at concurrency 8 — always truthful, never a
      stale row, and a ~2.5 s fleet load at 30 worktrees on every pull-to-
      refresh
- [ ] Memoize per worktree on a key of HEAD's sha, the mtime of the state's
      steering file, and the mtime of the loop log — a warm fleet load is
      milliseconds; the cost is that a change no part of that key covers shows a
      stale row until something in the key moves
- [ ] _your answer_

## Packages

Five packages from nine concerns. Build order is the order below: each one is
usable on its own, and each later one consumes an interface an earlier one
created.

### P1 — `gtd serve`, its config key, the HTTPS binding contract, and the client build harness

Merges concerns 1 and 8. Both center on `src/Cli.ts` and `package.json`, and
neither is independently valuable: a server with no client serves nothing, and a
client with no server has nowhere to run.

**Structure.** `src/serve/` owns the node half, `src/web/` the browser half.
New: `src/serve/Options.ts` (flags over config, resolved once),
`src/serve/ Tls.ts`, `src/serve/Bind.ts`, `src/serve/Qr.ts`,
`src/serve/Server.ts`, and `src/web/main.tsx` plus `src/web/index.html`.

**The config key.** `serve:` becomes the fourth top-level member of
`ConfigSchema` in `src/ConfigSchema.ts` — `roots`, `port`, `host`, `cert`,
`key`, `loop`. It follows the file's existing pattern:
`Schema.optional(Schema. Unknown.annotations({ jsonSchema: serveJsonSchema }))`
with a hand-written JSON Schema constant beside the others, so
`scripts/generate-schema.ts` regenerates `schema.json` with no edit to the
generator. The top level is `additionalProperties: false` and decoding uses
`onExcessProperty: "error"`, so until this lands a `serve:` key is a usage error
— which is the correct behavior, not a bug. `ConfigSchema.ts` must not reach the
`.yaml` text loader (`generate-schema.ts` runs under jiti), so the `serve:`
shape stays a literal. Compilation joins
`compileWorkflowConfig`/`compileVarsMap`/`compileModesMap` as a fourth
`compileServeConfig` in `src/PatternConfig.ts`, and the deep-merge walk-up
already gives innermost-wins precedence for free.

**The CLI row.** `src/Cli.ts` is a hand-rolled table-driven parser, so `serve`
is one `COMMAND_ROWS` entry plus `FLAGS` rows for `--host`, `--self-signed` and
`--dev`, each scoped to `kind === "serve"`. `--port` already exists for
`visualize` and its `scope` widens to both. `renderHelp()` is generated from
those two tables, and `src/Cli.test.ts:795` pins `docs/cli.md`'s `## Commands`
fence equal to `renderHelp()` byte-for-byte — so `docs/cli.md` is updated in
this same commit or the suite reds. `Needs` for `serve` is `"config"`: it needs
a config and a filesystem, but it must not require the _serving_ directory to be
a repo with a commit, because the roots it scans are elsewhere.

**HTTPS and binding.** `node:crypto`'s `X509Certificate` parses certificates; it
cannot issue one. `--self-signed` therefore spawns `openssl`, verified working
on this machine's LibreSSL 3.3.6:

```
openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem -days 825 \
  -subj /CN=gtd \
  -addext subjectAltName=IP:<tailnet-ip>,DNS:<tailnet-name> \
  -addext extendedKeyUsage=serverAuth \
  -addext basicConstraints=critical,CA:FALSE
```

The SAN must carry the IP, not just a CN — iOS ignores CN entirely. `serverAuth`
is the extension concern 1 names, and 825 days is the longest iOS accepts.
Tailscale detection reads `os.networkInterfaces()` for an IPv4 inside
`100.64.0.0/10` and never shells out to a `tailscale` binary, which is not
installed on this machine. No tailnet address and no `--host` refuses to start.

**Errors.** The exit-code table stays closed at `{0, 1, 2, 130, 143}` —
`src/ExitCodes.test.ts` pins the set and `src/Cli.test.ts:802` pins
`docs/cli.md`'s table against it. Port in use, a missing or unreadable
certificate, an absent `openssl`, and "no tailnet and no `--host`" are all
runtime refusals riding a failing Effect's message, which `Cli.ts`'s shared
refusal path prints to stderr at exit 1. A bad flag is exit 2 through the
existing tokenizer. 130/143 are real re-raised signals via `src/main.ts`'s
teardown and need no new code.

**The client build.** `tsdown.config.ts` becomes an array of two configs,
ordered browser-first: the browser config bundles `src/web/main.tsx` with
`platform: "browser"`, then a tiny step inlines that output into
`src/web/app.html` as one `<script type="module">`, and the existing node config
imports that file through the `.html` text loader already configured — the same
mechanism `src/ visualize.html` (79 KB, hand-written, no build step) already
uses. `src/web/ app.html` is generated and gitignored beside `schema.json`, so
`format:check` never sees it. `gtd serve --dev` reads `src/web/` off disk
instead.

**Gates the client must pass, and what each one needs.** `tsconfig.json` already
has `"jsx": "react-jsx"` and `include: ["src", "tests"]`, so `.tsx` typechecks
with no change — but `lib` is `["ESNext"]` with **no `DOM`**, and widening it
globally would let node-side code reach `document` and `fetch` unchallenged. So
`src/web/tsconfig.json` adds `DOM`/`DOM.Iterable` for that directory only, and
`typecheck` runs both invocations. `.oxlintrc.json` adds the `react` plugin to
its `plugins` list. `.fallowrc.json` adds `src/web/main.tsx` as an entry, or the
entire client reads as dead code. `stryker.config.json`'s `mutate` array doubles
as vitest's coverage `include`, so `src/web/**` stays out of it —
mutation-testing React components buys nothing.

**`test:web` needs all three, or `tests/tooling/turbo.test.ts` fails**: a
`package.json` script, a `turbo.json` task with an explicit `inputs` array
covering `src/web/**`, and the task name in the `test` script's list.

Primary paths: `src/Cli.ts`, `src/Cli.test.ts`, `src/ConfigSchema.ts`,
`src/ConfigSchema.test.ts`, `src/PatternConfig.ts`, `src/program.ts`,
`src/serve/Options.ts`, `src/serve/Tls.ts`, `src/serve/Bind.ts`,
`src/serve/Qr.ts`, `src/serve/Server.ts`, `src/web/main.tsx`,
`src/web/index.html`, `src/web/tsconfig.json`, `tsdown.config.ts`, `turbo.json`,
`package.json`, `.oxlintrc.json`, `.fallowrc.json`, `.gitignore`,
`stryker.config.json`, `docs/cli.md`, `docs/configuration.md`.

### P2 — worktree discovery and the fleet screen

Concern 2, unmerged. Ships alone as a read-only triage dashboard, which is
already worth having.

**Discovery.** `src/serve/Discover.ts` walks each configured root to depth 4,
skipping `node_modules`, dotted directories and symlinks, and yields every
directory containing a `.git` entry of either shape. A linked worktree's `.git`
is a _file_ holding a `gitdir:` pointer — `src/WorktreeState.ts`'s
`worktreeGitDir` already parses exactly that, filesystem-only, no `git`
subprocess, and it is reused rather than re-implemented. A worktree's URL
identity is the first 12 hex of a SHA-256 of its absolute path.

**The read.** One `gtd next --json` per worktree, cwd set to the worktree,
output parsed as JSON. The document is **projected server-side to a fleet row
and never shipped whole** — this repository's own beat is 7.9 KB because
`content` and `system` carry the entire prompt, and 30 of those is a quarter
megabyte for five fields. The row is
`{id, repo, branch, label, kind, actor, idle, restedAt, bucket}`.

**The buckets.** `idle` is load-bearing and `actor` alone is not: an idle
worktree reports `actor: human` too. So _Wants you_ is
`(!idle && actor === "human") || kind === "stalled"`, _Working_ is the
loop-registry answer from P5 (before P5 lands, nothing is ever Working),
_Broken_ is spawn failure, a JSON.parse failure, or a version outside the
supported range, and _Quiet_ is `idle`, collapsed behind its count. Rest age is
HEAD's committer date — there is no rest timestamp on the beat, and the last
turn commit is the moment the rest began. Wants-you sorts oldest-first, every
other bucket newest-first. The wants-you count goes in `document.title`.

**Errors.** A worktree with no gtd config is **not** broken: it resolves through
the bundled default workflow and returns `kind: message` with workflow warnings
on stderr, and stderr on a zero exit is discarded. Broken rows carry the
captured stderr verbatim, because that text is the only thing distinguishing one
refusal from another.

Primary paths: `src/serve/Discover.ts`, `src/serve/Beat.ts`,
`src/serve/Fleet.ts`, `src/serve/Router.ts`, `src/web/screens/Fleet.tsx`,
`src/web/api.ts`.

### P3 — writing into a live worktree

Concern 5, unmerged. Its footprint is the _format_ modules, which no other
package touches, and every screen in P4 writes through it.

**The edit model.** Every write is a list of `SteeringEdit` values —
`{range, newText}` — spliced by byte offset into the file's existing bytes.
Nothing is ever re-stringified. `ReviewDoc.clearFilePointerTicks` already
documents why: a `split`/`join` round-trip normalizes CRLF. `toggleFilePointer`
and `OpenQuestions.toggleCheckbox` already return exactly this shape and are
reused.

**The gap this package fills.** Footnote _insertion_ exists nowhere. Attaching a
note means two edits at once — a `[^id]` marker at the anchor's end and a
`[^id]:` definition — and it is shared by chunk notes, hunk notes and paragraph
notes alike. It belongs in `src/Footnotes.ts` beside the marker and definition
readers, which already own the naming rules including the case-insensitive fold.
Ids are derived from the anchor, never counted, so two concurrent attaches
cannot collide on `fn3`.

**Compare-and-swap.** Every write carries `{head, hash}` — HEAD's sha and a
SHA-256 of the steering file's exact bytes. The server re-reads both at write
time and writes only on an exact match. A mismatch **rejects outright**: no
semantic re-apply, no merge, no retry. The client keeps the input as a
`localStorage` draft keyed on worktree id plus file path and shows a banner
naming which of the two moved. A background refresh replaces the screen only
when no draft exists for it.

**The rest gate.** Editing is offered only when the beat's `actor` is `human`.
The server re-checks this at write time, not just at render time, because the
loop may have moved on since the screen was drawn.

**Formatting.** The server writes raw bytes and normalizes nothing. It does not
have to: this repository's own `.gtdrc.json` gives both `qa` and `review` a
`format:` command, and `gtd next --json`'s `validate` field emits
`npx oxfmt --write '<file>'` _ahead of_ the validator, which the driver runs
before `gtd land`. **Risk, blunt**: oxfmt's `*.md` override is
`printWidth: 80, proseWrap: "always"`, so a note the server writes gets reflowed
before it is committed, and a reflow that breaks the document's own validator
deadlocks the round rather than failing loudly. `src/ModeContradiction.ts` is
the existing guard for exactly that class of bug, and it round-trips each
format's `sample` through the mode's `format:` — the sample must grow a
server-written note so the guard covers this path.

**Errors.** A stale token, a rest that is not `human`, a file that vanished, and
an anchor that no longer parses are four distinct typed refusals, and the phone
names which one it got. Emitted scripts carry no expiry check anywhere in gtd,
so a generated script must be run promptly and never queued.

Primary paths: `src/Footnotes.ts`, `src/Footnotes.test.ts`, `src/ReviewDoc.ts`,
`src/OpenQuestions.ts`, `src/SteeringFormat.ts`, `src/SteeringFormats.ts`,
`src/ModeContradiction.ts`, `src/serve/Write.ts`, `src/serve/Router.ts`.

### P4 — the review screen, the plan-and-answer screen, and dictation

Merges concerns 3, 4 and 9. All three co-own the same components: a card list
that drills into a one-item-per-screen deck, and one note sheet. The paragraph
seam of concern 4 is a third anchor mode _inside_ that sheet, not a consumer of
it, and the mic of concern 9 is a leaf both the sheet and the free-text option
render. Splitting them makes one package own the shell and the other rewrite it.

**The view models.** `src/serve/View.ts` turns a steering file plus its mode
into what the screen draws, projecting the format's own parse. `review` gives
`ReviewDoc` — `{shortHash, fullHash, changesets, findings}` with
`Changeset {title, description, files, headingLine}` and
`ReviewFile {path, line, checked, note, sourceLine, endLine}`. `qa` gives
`OpenQuestionsDoc` — `{questions, findings}` with
`OpenQuestion {question, status, text, headingLine, options, answered}`.

**Answering is radio, and the predicate already exists.** `isAnswered` in
`src/OpenQuestions.ts` requires exactly one tick and rejects a ticked free-text
option whose text is empty; `unansweredQuestions` is the single predicate both
`answerCompletenessGuard` at land and `gtd check qa --open-questions` enforce.
The client renders radio semantics and the server never re-derives the rule.
`freeText` is the **last** option positionally, not by label, and its text
normalizes to empty when it equals `_your answer_` case-insensitively.

**Section order is a validator rule, not a UI convention.** `checkSectionOrder`
refuses a `##` before `## Open Questions` or after `## Answered Questions`. The
"Already answered" list is therefore a read of the second section, and moving a
question between them is a P3 edit that respects that order.

**Hunk pointers, and the reconstruction this package owns.** A hunk row is
`- [ ] ./path#42 note[^fn]`. That is one 1-based post-image line number —
**there is no line range, no `@@` header, no hunk index** — and `#42` is
optional, a bare `./path` meaning line 0. gtd contains no unified-diff parser at
all (`src/Git.ts` runs only `git diff --name-status -z`), so `src/serve/Diff.ts`
is new: run `git diff -U3 <base> -- <path>` in the worktree, parse the
`@@ -a,b +c,d @@` headers, and select the hunk whose post-image range contains
the pointed-at line. `<base>` is `gtd base`, which prints the review anchor and
refuses at exit 1 when no process is underway. When no hunk contains the line —
a stale pointer, a moved line, or a bare `./path` — the screen shows that path's
whole diff behind a banner saying the pointer did not resolve, rather than an
empty deck. Task items are collected at **any** nesting depth, so a nested hunk
is a hunk.

**Highlighting.** The prototype's own ten-line single-pass tokenizer, ported
verbatim. No shiki, no highlight.js — a language grammar bundle would dwarf the
entire client, and the diff lines being read on a phone are short.

**What a tick means, stated plainly, because it is counter-intuitive.** Ticks
are read-progress and nothing else. `gtd uncheck` runs as a command edge _ahead
of_ the human review gate's commit (`src/Edge.ts:936`, guarded by
`isHumanReviewGate`), clearing every tick, so no `[x]` can reach the deciding
state. The round stays open **iff the human left any byte-diff in REVIEW.md — a
note or a footnote — or edited any path outside `.gtd/`**;
`humanReview.deciding` decides feedback versus sign-off by comparing
`HEAD^:.gtd/REVIEW.md` against `HEAD:.gtd/REVIEW.md` in shell. That is why
concern 3's acceptance holds mechanically: a chunk carrying a footnote keeps the
round open however many hunks are ticked. And it is why a chunk tick ticking all
of that chunk's hunks is honest — `##` headings carry no checkbox in the format,
and read-progress is all a tick ever conveyed.

**Dictation.** `src/web/Mic.tsx`, on the free-text answer option and inside the
note sheet, nowhere else — the iOS keyboard's own mic covers every other
textarea for free. Feature-detect `SpeechRecognition || webkitSpeechRecognition`
and catch `not-allowed`: hide the button, keep the textarea, show a one-line
hint naming the keyboard's mic key. Interim results are displayed and never
written; the write-through happens on attach. This is the concern HTTPS is
mandatory for — the API is secure-context-only and fails silently over plain
http.

Primary paths: `src/serve/View.ts`, `src/serve/Diff.ts`,
`src/serve/Diff.test.ts`, `src/web/screens/Review.tsx`,
`src/web/screens/Hunk.tsx`, `src/web/screens/Plan.tsx`,
`src/web/screens/Question.tsx`, `src/web/NoteSheet.tsx`, `src/web/Highlight.ts`,
`src/web/Mic.tsx`, and each of those files' stories.

### P5 — handing the turn back, and loop lifecycle

Merges concerns 6 and 7. Both center on the same new process port and the same
in-memory registry; 7 is that module's lifecycle half, not a consumer of an
interface 6 exposes.

**The port.** `src/serve/Loop.ts` spawns the configured loop command with the
worktree as cwd, **separate** stdout and stderr pipes, and a shim directory
prepended to `PATH` so bare `gtd` resolves to that worktree's own binary — a
mode's seeded validate command is literally `gtd check <mode> '<file>'`, invoked
by name from inside an emitted script. This is a second process port beside
`CommandRunner`, which merges the two streams and is pinned to `Cwd.root`;
`CommandRunner`'s "only place gtd itself spawns a subprocess" comment is amended
in this commit rather than left to rot.

**Completion.** "The child exited, now re-read `gtd next --json`." The exit code
is ignored and the output is not parsed, because the beat document is the truth.
Any loop command in any language satisfies that. The phone returns to the fleet
list and the worktree sits in _Working_ until the child exits. A failure shows
the captured output and the exit code inline, because gtd exits 1 for every
refusal and the text is the only discriminator.

**The registry.** An in-memory map from worktree id to child handle. A worktree
already in the map is never double-driven — the done action refuses rather than
queueing. For a **foreign** driver the only available signal is the mtime of the
`log` path the beat already reports, and that signal is imprecise by nature:
`loopLogPath` honors `$GTD_LOOP_LOG` then `$GIT_DIR` then the worktree's git
dir, gtd never creates or truncates the file, and a driver may not write to it
at all. The UI must say so where it surfaces it, in those words, not hedge it.

**Stop.** SIGINT first, SIGKILL after a timeout. SIGINT is what Ctrl-C sends and
`src/main.ts` re-raises it as a real signal death after the fiber unwinds, so
the loop gets a chance to finish its beat and a parent's `wait` sees
`WIFSIGNALED` at 130 — a code the table already carries, needing no new entry.

**Restart.** The child is killed and nothing is persisted. Each worktree reports
its real rest on the next read, a dirty `prompt` rest reads as interrupted, and
nothing auto-resumes. Session ids are derived, not stored — `resolveSession` is
a uuidv5 over a fixed namespace — so a restart loses nothing resumable, and they
are the loop command's concern regardless. Concurrency is unlimited by explicit
decision.

Primary paths: `src/serve/Loop.ts`, `src/serve/Loop.test.ts`,
`src/serve/Registry.ts`, `src/serve/Shim.ts`, `src/CommandRunner.ts`,
`src/serve/Router.ts`, `src/web/screens/Fleet.tsx`.

## Merged Concerns

Each merged requirement is carried below byte-verbatim, inside a fence so no
formatter reflows it and no heading of its own counts against the document's
section order. Spec review covers each independently.

### P1 merges concerns 1 and 8

```markdown
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
```

```markdown
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
```

### P4 merges concerns 3, 4 and 9

```markdown
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
```

```markdown
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
```

```markdown
### 9. Dictation — PRODUCT

A mic button using the Web Speech API on the free-text answer option and in the
note sheet, and nowhere else; the iOS keyboard's own dictation covers every
textarea for free. No server-side transcription. Dictated text writes through on
attach, never on interim results.

**Acceptance**: feature-detect and catch `not-allowed` — hide the mic, keep the
textarea, show a one-line hint naming the keyboard's mic key. The capability
research is [#216](https://github.com/pmelab/gtd/issues/216). See
[#220](https://github.com/pmelab/gtd/issues/220).
```

### P5 merges concerns 6 and 7

```markdown
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
```

```markdown
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
```

## Answered Questions

### Does the server read a worktree's state in-process or by spawning that worktree's own `gtd`?

By spawning it. Concern 2 already names "spawn failed", "unsupported version"
and "unparseable beat" as the three Broken causes, and none of those failure
modes exists for an in-process read.

### How does the browser bundle get inside the single node bundle?

`tsdown.config.ts` exports an array, browser config first; its output is inlined
into a generated, gitignored `src/web/app.html` which the node config imports
through the existing `.html` text loader — the mechanism `src/visualize.html`
already uses.

### How is a self-signed certificate issued, given `node:crypto` cannot issue one?

By spawning `openssl req -x509 -addext ...`, verified working here on LibreSSL
3.3.6 with both `serverAuth` and an IP SAN; an absent `openssl` is a runtime
refusal at exit 1, which costs zero new runtime dependencies.

### How is the Tailscale interface detected?

By scanning `os.networkInterfaces()` for an IPv4 in `100.64.0.0/10`, not by
shelling out to a `tailscale` binary — which is not installed on this machine
and is not a dependency worth acquiring.

### Which process port runs the loop command?

A new one in `src/serve/Loop.ts`. `CommandRunner` merges stdout into stderr and
is pinned to `Cwd.root`, and concern 6 requires the two streams intact plus a
per-worktree cwd.

### What highlights the diff?

The prototype's own ten-line single-pass tokenizer, ported verbatim; a real
grammar bundle would dwarf the whole client for lines being read on a phone.

### Which diff hunk does `./path#42` mean, and what happens when nothing matches?

The `@@` hunk whose post-image range contains line 42 of
`git diff -U3 $(gtd base) -- path`; when no hunk contains it — a stale pointer,
a moved line, or a bare `./path` — the screen shows that path's whole diff
behind a banner saying the pointer did not resolve.

### What tells the fleet how long a worktree has rested?

HEAD's committer date. The beat carries no rest timestamp, and the last turn
commit is exactly when the rest began.

### Who normalizes the markdown the server writes?

Nobody in the server: writes are byte-range splices only, and the mode's own
`format:` command runs inside `gtd next --json`'s `validate` script ahead of the
validator, which the driver runs before `gtd land`.

### How does browser code get DOM types without loosening the node side?

A second `src/web/tsconfig.json` adding `DOM`/`DOM.Iterable`, with `typecheck`
running both invocations — the root `lib` is `["ESNext"]` and widening it
globally would let node-side code reach `document` unchallenged.

### Where do footnote ids come from when two notes are attached at once?

They are derived from the anchor, never counted, so two concurrent attaches
cannot both claim `fn3`.

### Does the fleet ship the whole beat document to the phone?

No — it is projected server-side to nine fields. This repository's own beat is
7.9 KB because `content` and `system` carry the entire prompt.
