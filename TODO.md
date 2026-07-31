# Loop-driver output & editor-status polish

Three small improvements to the bash loop driver (`bin/gtd`). All three live
purely at the bash edge — the compiled bundle, the pure engine, and every
workflow template are untouched. No `STATES.md`, version, or changelog edit
(releases are semantic-release-driven from the conventional commits).

## The three improvements

1. **Cap matched-file display at 3 and move it to rows below the line.** Today a
   transition/commit line renders its changed files inline as a comma-joined
   `(a, b, c, d)` tail. Instead, print the files as indented rows _below_ the
   transition/commit line, at most 3 of them, with a `… (N more)` row when there
   are more.
2. **Remove the extra leading space from transition lines.** `emit_transition`
   puts two spaces between the marker and the `from` state; every other emitter
   uses one. Drop it to one so transition lines align with the rest.
3. **Report `blocked` to Herdr while the loop's editor is open.** When the loop
   opens the editor at a human gate and blocks waiting for it to close, the
   Herdr pane state should be `blocked` (a human is needed) for the duration of
   the edit, flipping back to `working` once the editor exits and the loop
   resumes driving. Today that window is reported as `working` throughout.

## Decisions (judgement calls, with rationale)

- **The 3-file cap + rows apply to BOTH transition lines and bare-subject
  capture/squash lines** (`emit_transition` _and_ `emit_commit`), via one shared
  `emit_file_rows` helper. The sketch names the transition line, but a
  capture/squash line renders the same `(files)` tail with the identical
  overflow problem — splitting the behavior between the two emitters would be a
  gratuitous inconsistency. One helper, one rule.
- **File rows are indented 3 spaces, dim.** `->` (plain) / `➡️` (fancy) plus its
  trailing space is ~3 columns, so a 3-space indent sits the file list under the
  `from` state on both palettes. Dim matches the muted styling the files already
  had inline.
- **Overflow marker is `…` (fancy) / `...` (plain)**, added to the existing
  FANCY/plain marker block as `M_ELLIPSIS`, so the non-tty/`NO_COLOR` path stays
  pure ASCII like every other plain marker. The overflow row reads
  `   <M_ELLIPSIS> (N more)` where `N` = total files − 3.
- **Only transition lines lose the double space — `emit_gate` keeps its two
  spaces.** The sketch says "transition lines"; `emit_gate` ("`[you]  idle`")
  has a scenario asserting the two-space form (`gtd-loop.feature`:
  `stdout contains "[you]  idle"`), and it is a different line class (a gate
  instruction, not a capture). Leaving it alone keeps the change scoped and the
  suite green.
- **Editor-open Herdr state uses `blocked` with NO extra notification.** The
  `--no-edit` gate path already pairs `blocked` with a `notification show`, but
  there the loop is _halting_ and the human may be away. Here the editor is
  opening in front of the human right now — the editor _is_ the prompt — so a
  notification would be redundant noise. Scope is "state should be blocked", so
  only the state flips; `herdr_notify` is not added.
- **`blocked` is set only in the editing-ON path**, right around
  `launch_editor`. The editing-OFF (`--no-edit`) branch already reports
  `blocked` before halting, and `launch_editor` is the _only_ place the loop
  blocks on an editor, so this one bracket covers every loop editor-open case
  (opening move and every mid-loop `"message"` rest both route through
  `handle_human_gate`). The `edit`/`log` subcommands open an editor too but are
  not loop runs, so they are untouched.

## `bin/gtd` changes

### 1. Marker block — add the ellipsis marker (`bin/gtd:73-83`)

Add one marker to each branch of the `if [[ "$FANCY" == 1 ]]` palette block:

- fancy branch: `M_ELLIPSIS="…"`
- plain branch: `M_ELLIPSIS="..."`

### 2. New `emit_file_rows` helper (new, beside the other emitters ~`bin/gtd:98`)

```bash
# emit_file_rows <files> — render a commit's changed files as dim, indented
# rows BELOW the transition/commit line: at most 3, then a "… (N more)" row
# when there are more. <files> is a newline-separated list (git diff-tree
# --name-only output); empty input prints nothing.
emit_file_rows() {
  local files="$1" f shown=0 total=0
  [[ -z "$files" ]] && return 0
  while IFS= read -r f; do [[ -n "$f" ]] && total=$((total + 1)); done <<<"$files"
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if ((shown >= 3)); then
      printf '   %s%s (%d more)%s\n' "$C_DIM" "$M_ELLIPSIS" "$((total - 3))" "$C_RESET"
      break
    fi
    printf '   %s%s%s\n' "$C_DIM" "$f" "$C_RESET"
    shown=$((shown + 1))
  done <<<"$files"
}
```

### 3. Rewrite `emit_transition` (`bin/gtd:85-98`)

Print only the header line (single space now — improvement 2), then delegate the
files to `emit_file_rows`:

```bash
emit_transition() {
  local from="$1" to="$2" files="$3"
  printf '%s %s%s → %s%s\n' \
    "$M_TRANS" "$C_BOLD$C_CYAN" "$from" "$to" "$C_RESET"
  emit_file_rows "$files"
}
```

(The `if [[ -n "$files" ]]` inline-vs-not split is gone; `emit_file_rows` no-ops
on empty input.)

### 4. Rewrite `emit_commit` (`bin/gtd:106-116`)

Same shape — header line unchanged (it already uses a single space), files moved
to rows:

```bash
emit_commit() {
  local subject="$1" files="$2"
  printf '%s %s%s%s\n' "$M_COMMIT" "$C_GREEN" "$subject" "$C_RESET"
  emit_file_rows "$files"
}
```

### 5. `report_commits` — emit a newline list, not a comma-joined string (`bin/gtd:183`)

```bash
files="$(git diff-tree --no-commit-id --name-only -r "$sha")"
```

(drop the `| paste -sd, - | sed 's/,/, /g'`). `emit_file_rows` now owns
presentation.

### 6. `handle_human_gate` — `blocked` while the editor is open (`bin/gtd:413-416`)

```bash
file="$(jq -r '.file // empty' <<<"$json")"
herdr_report blocked "$label"        # was: herdr_report working "$label"
launch_editor "${file:-.}"
herdr_report working "$label"        # NEW: resume driving once the editor closes

head_before="$(git rev-parse HEAD 2>/dev/null || echo none)"
...
```

The subsequent branches are unchanged: a refusal exits (trap re-reports
`blocked`), a zero-commit close reports `idle` + `release`, and a captured
commit keeps driving (the next iteration re-reports `working`).

## e2e scenarios (`tests/integration/features/gtd-loop.feature`, the `@live` suite)

Reuse the existing Given steps (`a test project`,
`a gtd config file at ".gtdrc" with:`, `a commit ... that adds ...`,
`a stub agent script`, `a fake herdr binary`,
`$EDITOR is a script that appends {string} to the opened file`,
`the fake editor was opened on {string}`). No new step definitions are needed —
every assertion uses the existing `stdout contains` / `stdout does not contain`
/ `the fake herdr log contains, in order:` / `the fake editor was opened on`
steps. Tests run non-tty, so `FANCY=0` (plain markers: `->`, `[you]`, `...`).

1. **Transition line lists changed files as capped, indented rows (improvements
   1 + 2 together).** A `working` agent turn whose stub writes four files
   (`src/a.ts`, `src/b.ts`, `src/c.ts`, `src/d.ts`); `working`'s
   `on: "* **": checking` captures all four into the `working → checking`
   transition. Model on the scenario at `gtd-loop.feature:295`, seeding
   `gtd(agent): working`. Assert:
   - `stdout contains "-> working → checking"` — single space after the `->`
     marker (improvement 2; the pre-change output was `->  working`).
   - `stdout contains "src/a.ts"`, `"src/b.ts"`, `"src/c.ts"` — the first three
     rows (git lists `--name-only` sorted, so `a`/`b`/`c` show).
   - `stdout contains "(1 more)"` — the overflow row for the 4th file.
   - `stdout does not contain "src/d.ts"` — the 4th file is hidden behind the
     cap.
2. **Exactly three changed files show all three rows and no overflow.** Same
   shape, stub writes exactly `src/a.ts`, `src/b.ts`, `src/c.ts`. Assert all
   three appear and `stdout does not contain "more)"` (proves no ellipsis row at
   the boundary).
3. **The loop reports `blocked` to Herdr while the editor is open, then
   `working` after it closes (improvement 3).** A human-gate workflow whose gate
   declares a `file:` so the editor opens a real file:
   ```
   idle:     actor: human, initial, message, file: NOTE.md, on: "M NOTE.md": working
   working:  actor: agent, prompt, on: "* **": checking
   checking: actor: check, script: "true", on: "C": done
   done:     commit: "chore: done"
   ```
   Seed `NOTE.md` (committed) so the machine rests at the `idle` gate; provision
   `a fake herdr binary` and
   `$EDITOR is a script that appends "go" to the opened file` (so the edit
   yields `M NOTE.md`, captured by `idle`'s `on`); a stub agent writes
   `src/calc.ts`. `When I run bare gtd`. Assert:
   - `the fake editor was opened on "NOTE.md"`.
   - `the fake herdr log contains, in order:` — `--state blocked --message idle`
     (editor open) THEN `--state working --message idle` (editor closed, loop
     resuming). Proves the blocked window brackets exactly the editor.
   - `it succeeds` and the loop drives on
     (`the git log contains "chore: done"`).

## Documentation (global rule: reflect every change in docs)

- **`docs/loop.md`** — the "Herdr integration" mapping table
  (`docs/loop.md:270`) gains a row: _"While the editor is open at a human gate
  (editing on) → `report-agent --state blocked`, flipped back to `working` once
  it closes."_ If the doc anywhere shows the inline `(files)` tail on a sample
  transition line, update the sample to the new rows-below form.
- **`docs/cli.md`** — if any sample loop output shows the inline `(files)` tail
  or the double-spaced `->  ` transition line, update it to the capped
  rows-below form with a single space. (Scan for `(` file-list tails and
  `->  `.)
- **`skills/loop/SKILL.md`** — the "Herdr reporting" section (`SKILL.md:200`)
  already lists `working|blocked|idle`; add a clause that a human-gate editor
  session is reported `blocked` for its duration. The rows-below/3-cap file
  rendering is cosmetic driver output, not part of the driver contract the skill
  specifies, so it needs no mention there.
- **`README.md`** — no change unless it embeds a sample loop transition line
  with the old inline-files or double-space form; if so, refresh that sample.

## Order of work

1. `bin/gtd` §1–6 (marker, `emit_file_rows`, `emit_transition`, `emit_commit`,
   `report_commits`, `handle_human_gate`).
2. `npm run build` (bundle), then the three scenarios; iterate until the `@live`
   `gtd-loop.feature` passes.
3. Docs: `docs/loop.md`, `docs/cli.md`, `skills/loop/SKILL.md`, `README.md`.
