# Simplify the emitted-script model

Goal: `gtd land` becomes explainable in one sentence — "emits either one commit
or nothing". Four independent levers, each landable alone.

The no-op landing (clean tree at a `script`/`message` rest with no `C` row)
STAYS. It is what makes running the driver on a clean repo with nothing to do
produce nothing, and `idle` depends on it: forcing a `C` row there would author
a commit on every bare invocation. Only the HEAD-moving case goes away.

## 1. Delete the initial-state collapse

`land` must never move HEAD. Remove the collapse branch in `Edge.ts`'s
`renderDecision` (`collapsesWith` / `retainHistoryStep` / `mixedResetTo`), so a
process re-entering the initial state having retained nothing lands an ordinary
commit instead of rewinding.

- Price: `gtd --entry fix-precheck` against a green suite leaves two commits in
  the log instead of none.
- Follow-through: `LandResult.settled` loses one of its two sources, so it now
  means only "no-op at a `script` rest".
- `HISTORY_REF` loses its second writer, so `restore` becomes purely `abandon`'s
  inverse.

## 2. Move `format:`/`validate:` out of the landing

Drop `steeringModeSteps` from `program.ts`'s `buildRequiredScript`, so `land`'s
script is nothing but the commit. The driver already runs `gtd next --json`'s
`validate` field in a fix loop before landing.

- Price, stated plainly: the steering-file guards only bite if the driver
  actually ran validation. A hard guarantee becomes a driver contract.
- Decide this one on its own merits — it is the only lever that trades away
  correctness rather than log noise.

## 3. Add a prose form to `gtd land`

Free, cannot regress anything: `land --json` already carries `subject`. Add a
human-readable mode that prints "commit everything with this message: …" plus
any remaining pre-commit commands as numbered steps. The `script` field stays
the machine path.

## 4. Warn on a missing `C` row

Have `validateDefinition` WARN — never refuse — when a non-`prompt`, non-initial
state declares no `C` row. Usually an oversight rather than a decision, and
AGENTS.md already asks authors to make that call explicitly.

- Never a load-time error: the no-op is a legitimate choice (see the note at the
  top), so this surfaces the decision, it does not force one.
- Exempt the workflow's initial state explicitly — a `C` row there would author
  a commit on every bare driver invocation.

## Out of scope

The three things that keep `land` a script rather than a sentence, and are not
up for removal: the `expectedHead` assertion, the `index.lock` retry, and the
empty-commit hook fallback (`--allow-empty`, then `--no-verify` on a hook
rejection). Also unchanged: calling `land` is itself the assertion that a beat
was dispatched — that is what the empty attempt commit records and `stalledAt`
reads.
