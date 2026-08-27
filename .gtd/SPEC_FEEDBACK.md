# Spec feedback — 01 The four-command suite, with agent and models chosen by asking

Three problems, all in `src/Install.ts`'s `commandSuite()` briefing prose. The
four command bodies, `docs/driver.md`'s rename, and every acceptance assertion
check out; `npm test` is green and `gtd-review`/`gtd-fix` were smoke-tested end
to end (usage exit 2, refusal aborts before `exec`, success drives).

## 1. "Three of the four bodies" carry `GTD_BUILD` — only two do

`src/Install.ts`, the lead-in above the `gtd-build` section:

> Three of the four bodies below share one convention: `GTD_BUILD` is set once,
> at the top, to the suite's resolved `gtd-build` path.

`MINIMAL_DRIVER` has no `GTD_BUILD`, and neither does `EDIT_COMMAND`. Exactly
two bodies carry it: `REVIEW_COMMAND` and `FIX_COMMAND`. The spec's settled
decision says the same — "each NEW body carries `GTD_BUILD`".

Interview question 8 repeats the error: "the RESOLVED path baked into
`GTD_BUILD` in the other three bodies below". It is the other TWO bodies.

An installing agent that believes this adds a `GTD_BUILD` line to `gtd-edit` and
to `gtd-build` itself, or hunts for a line that is not there.

## 2. "Same body as the reference driver above" points at nothing

The `### gtd-build` section opens with:

> Same body as the reference driver above, renamed from `gtd-loop`; …

No driver body appears above it. The rendered briefing's first fenced block is
this section's own `MINIMAL_DRIVER` — the four fences sit at rendered lines 271,
386, 410 and 431, all inside `commandSuite()`. The reader is sent looking for a
body that does not exist.

Drop the back-reference and describe the block that is right there. Drop
"renamed from `gtd-loop`" with it: a user installing today never had a
`gtd-loop`, so it is repo history in user-facing prose.

## 3. Old question 6's content was deleted, and the spec never asked for that

The pre-change question 6 read:

> **How do they want to invoke it?** A command on PATH (default:
> `~/.local/bin/gtd-loop`), a project task-runner entry, a CI job step — or no
> artifact at all: YOU drive the beats yourself, following the obligations
> directly. Pick the runtime to match: bash, their language of choice, anything
> that reads `--json=<path>` and spawns subprocesses.

Slot 6 was reused for model resolution and none of that text survives anywhere.
New question 8 covers only the install directory and renaming. Four options the
briefing used to offer are now gone: a task-runner entry, a CI job step, NO
artifact at all with the agent driving the beats directly, and a non-`sh`
runtime of the user's choice.

The spec renumbers questions 4–6 and collapses 8–9; it never authorizes dropping
the invoke-shape question. Restore it — as its own numbered question, or folded
into question 8 — with `gtd-build` as the default-path example in place of
`gtd-loop`.
