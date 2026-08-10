/**
 * The human-facing wording for what a `gtd`-emitted script just landed —
 * printed by the DRIVER's bash when it runs `required`/`optional`, authored
 * once here in TS. Pure, like `src/GitScript.ts`: no git, no filesystem, no
 * `Effect`. `OUTCOME_PREAMBLE` defines the bash functions
 * (`gtd_report_transition`/`gtd_report_commit`/`gtd_report_note`/
 * `gtd_report_abandoned`/`gtd_report_restored`) a script calls; the builders
 * below emit the one-line calls, every argument routed through
 * `src/GitScript.ts`'s `shellQuote`.
 *
 * `abandon`/`restore`/no-op wording is also printed as PLAIN TEXT by
 * `src/program.ts` at decide time (before any script has run) — its format
 * strings live once here (`FMT_*`, with `%s` placeholders) and reach both
 * sides through `renderFormat` (the plain path) and `printfLine` (the bash
 * `printf` call embedded in `OUTCOME_PREAMBLE`), so the two can never drift.
 */

import { shellQuote } from "./GitScript.js"

/** Substitute `args` into `fmt`'s `%s` placeholders, in order — the plain-text twin of `printfLine`. */
export const renderFormat = (fmt: string, ...args: readonly string[]): string => {
  let i = 0
  return fmt.replace(/%s/g, () => args[i++] ?? "")
}

/**
 * A `printf '<fmt>' <args...>` bash statement — `args` are already-valid bash
 * tokens (a variable reference like `"$from"`), never re-quoted here: a value
 * reaches the script as a printf ARGUMENT, never interpolated into the format
 * itself, so a subject or state name containing `%` can never be read as a
 * conversion spec.
 */
const printfLine = (fmt: string, args: readonly string[]): string =>
  `printf ${shellQuote(fmt)} ${args.join(" ")}`

const FMT_NOOP = 'nothing to do at "%s"\n'
const FMT_ABANDON_NOOP = 'no gtd process is underway (resting at "%s") — nothing to abandon\n'
const FMT_ABANDONED =
  'abandoned the process resting at "%s" — HEAD is back at %s ("%s"), resting at "%s".\n' +
  "Everything the process produced is kept as uncommitted changes (`git status`); " +
  "discard them with `git checkout -- . && git clean -fd .gtd` for a clean tree.\n"
const FMT_RESTORED =
  'restored the retained history — HEAD is back at %s ("%s"), resting at "%s". Resume ' +
  "with the loop, or `git reset` to any earlier turn to restart from there.\n"

/** `nothing to do at "<state>"` — a no-op step's plain-text line, and the text a print-only script's `gtd_report_note` carries. */
export const noopText = (state: string): string => renderFormat(FMT_NOOP, state)

/** The initial-state collapse's own line — no commit landed, HEAD was rewound
 *  to the process's start parent. Trailing newline, exactly like `noopText`:
 *  printed verbatim by `program.ts` and via `noteOutcome`/`gtd_report_note` by
 *  the emitted script. */
export const COLLAPSED_TEXT =
  "nothing to retain — rewound to the commit before the process started\n"

/** `no gtd process is underway (resting at "<initial>") — nothing to abandon` — `gtd abandon`'s no-op plain-text line. */
export const abandonNoopText = (initial: string): string => renderFormat(FMT_ABANDON_NOOP, initial)

/** `gtd abandon`'s two-line plain text: the `from`/short-hash/subject/`state` prose, then the "everything is kept" note. */
export const abandonedText = (
  from: string,
  headShort: string,
  subject: string,
  state: string,
): string => renderFormat(FMT_ABANDONED, from, headShort, subject, state)

/** `gtd restore`'s one-line plain text. */
export const restoredText = (headShort: string, subject: string, state: string): string =>
  renderFormat(FMT_RESTORED, headShort, subject, state)

/**
 * The bash preamble every outcome-carrying script includes, ONE block (no
 * blank lines, like `src/Emit.ts`'s `RETRY_HELPER`) so `assembleScript`'s
 * blank-line-joined sections stay intact. First line is a literal comment
 * naming this module, so a reader (or the recognizer) can tell at a glance
 * where the block comes from.
 *
 * The palette/marker detection mirrors `bin/gtd`'s own `FANCY` check exactly
 * (`[ -t 1 ] && [ -z "${NO_COLOR:-}" ]`) and its exact plain-mode fallback
 * strings (`->`/`[commit]`/`...`), so existing `@live` assertions on the
 * bundle's plain output keep matching once this preamble takes over printing
 * it. `gtd_files` mirrors `bin/gtd`'s `report_commits` (the diff-tree read,
 * now with `--root` so a repository's very first commit shows its files
 * too) + `emit_file_rows` (the 3-row cap) fused into one function, since a
 * script-side caller always has the commit, never a pre-fetched file list.
 */
export const OUTCOME_PREAMBLE = [
  "# gtd: human-facing outcome rendering (see src/OutcomeScript.ts)",
  'if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then',
  "  gtd_c_reset=$'\\e[0m'; gtd_c_bold=$'\\e[1m'; gtd_c_dim=$'\\e[2m'",
  "  gtd_c_cyan=$'\\e[36m'; gtd_c_green=$'\\e[32m'",
  '  gtd_m_trans="➡️"; gtd_m_commit="✅"; gtd_m_ellipsis="…"',
  "else",
  '  gtd_c_reset=""; gtd_c_bold=""; gtd_c_dim=""',
  '  gtd_c_cyan=""; gtd_c_green=""',
  '  gtd_m_trans="->"; gtd_m_commit="[commit]"; gtd_m_ellipsis="..."',
  "fi",
  "gtd_files() {",
  '  local sha="$1" f shown=0 total=0 files',
  '  files="$(git diff-tree --no-commit-id --name-only -r --root "$sha" 2>/dev/null || true)"',
  '  [ -z "$files" ] && return 0',
  '  while IFS= read -r f; do [ -n "$f" ] && total=$((total + 1)); done < <(printf \'%s\\n\' "$files")',
  "  while IFS= read -r f; do",
  '    [ -z "$f" ] && continue',
  '    if [ "$shown" -ge 3 ]; then',
  '      printf \'   %s%s (%d more)%s\\n\' "$gtd_c_dim" "$gtd_m_ellipsis" "$((total - 3))" "$gtd_c_reset"',
  "      break",
  "    fi",
  '    printf \'   %s%s%s\\n\' "$gtd_c_dim" "$f" "$gtd_c_reset"',
  "    shown=$((shown + 1))",
  "  done < <(printf '%s\\n' \"$files\")",
  "}",
  "gtd_report_transition() {",
  '  local from="$1" to="$2"',
  '  printf \'%s %s%s → %s%s\\n\' "$gtd_m_trans" "${gtd_c_bold}${gtd_c_cyan}" "$from" "$to" "$gtd_c_reset"',
  "  gtd_files HEAD",
  "}",
  "gtd_report_commit() {",
  '  local subject="$1"',
  '  printf \'%s %s%s%s\\n\' "$gtd_m_commit" "$gtd_c_green" "$subject" "$gtd_c_reset"',
  "  gtd_files HEAD",
  "}",
  "gtd_report_note() {",
  "  printf '%s\\n' \"$1\"",
  "}",
  "gtd_report_abandoned() {",
  '  local from="$1" head="$2" state="$3" short subject',
  '  short="$(git rev-parse --short "$head")"',
  '  subject="$(git log -1 --format=%s "$head")"',
  `  ${printfLine(FMT_ABANDONED, ['"$from"', '"$short"', '"$subject"', '"$state"'])}`,
  "}",
  "gtd_report_restored() {",
  '  local to="$1" state="$2" short subject',
  '  short="$(git rev-parse --short "$to")"',
  '  subject="$(git log -1 --format=%s "$to")"',
  `  ${printfLine(FMT_RESTORED, ['"$short"', '"$subject"', '"$state"'])}`,
  "}",
].join("\n")

/** `gtd_report_transition <from> <to>` — a landed self-loop/target-change transition, with its changed-file rows. */
export const transitionOutcome = (from: string, to: string): string =>
  `gtd_report_transition ${shellQuote(from)} ${shellQuote(to)}`

/** `gtd_report_commit <subject>` — a bare capture or a squash's final commit, with its changed-file rows. */
export const commitOutcome = (subject: string): string => `gtd_report_commit ${shellQuote(subject)}`

/** `gtd_report_note <text>` — one already-rendered plain line, no marker. */
export const noteOutcome = (text: string): string => `gtd_report_note ${shellQuote(text)}`

/** `gtd_report_abandoned <from> <head> <state>` — resolves the post-hoc short hash/subject from `head` (a commitish) in-script. */
export const abandonedOutcome = (from: string, head: string, state: string): string =>
  `gtd_report_abandoned ${shellQuote(from)} ${shellQuote(head)} ${shellQuote(state)}`

/** `gtd abandon`'s no-op outcome — the same wording `abandonNoopText` renders, printed via `gtd_report_note`. */
export const abandonNoopOutcome = (initial: string): string => noteOutcome(abandonNoopText(initial))

/** `gtd_report_restored <to> <state>` — resolves the post-hoc short hash/subject from `to` (a commitish) in-script. */
export const restoredOutcome = (to: string, state: string): string =>
  `gtd_report_restored ${shellQuote(to)} ${shellQuote(state)}`
