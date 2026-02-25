# Clean Up Terminal Output

## Action Items

### Remove Blinking Cursor Animations

- [x] Remove the cursor timer from `setTextWithCursor` in
      `createSpinnerRenderer`
  - In the interactive branch, delete `cursorTimer` and `cursorVisible` state
    variables
  - Replace the `setTextWithCursor` body with the same logic as `setText`: write
    `◆ <text>\n` via `handler.ensureNewline()` + `process.stdout.write`
  - Remove the `HIDE_CURSOR` write and `setInterval` inside `setTextWithCursor`
  - Make `stopCursor` a no-op (remove `clearInterval` and
    `CLEAR_CHAR`/`SHOW_CURSOR` writes)
  - Tests: update all spinner tests that use `vi.useFakeTimers()` and
    `CLEAR_CHAR` assertions to reflect the cursor-free behaviour; assert that
    `setTextWithCursor` now ends with `\n` just like `setText`

- [x] Remove the cursor timer from `setTextWithCursor` in `createBuildRenderer`
  - Delete `bCursorTimer` and `bCursorVisible` state variables in the
    interactive branch
  - Replace the `setTextWithCursor` body: call `handler.ensureNewline()` then
    write `◆ <text>\n`
  - Remove `HIDE_CURSOR` write and `setInterval` inside `setTextWithCursor`
  - Make `stopCursor` (`stopBuildCursor`) a no-op
  - Tests: update the `createBuildRenderer` timer-advance tests; assert newlines
    are present without relying on `CLEAR_CHAR`

- [x] Remove dead `startSpinner` code from `createEventHandler`
  - `startSpinner` is defined but never called; delete it along with
    `spinnerTimer` and the inner `cursorVisible` state
  - Simplify `stopSpinner` to only emit `SHOW_CURSOR` (no `clearInterval` or
    `CLEAR_CHAR` needed when no timer is running)
  - Tests: existing "leaves no residual █" tests in `createEventHandler` suite
    should still pass; add a regression test that confirms no cursor-blink
    escape sequences appear in any stdout output during a full
    `ThinkingDelta → ToolStart` flow

### Ensure Every Message Lands on Its Own Line

- [x] Audit all `process.stdout.write` / `console.log` call sites in
      `Renderer.ts`, `DecisionTree.ts`, and command files for missing trailing
      newlines
  - After cursor removal, `setTextWithCursor` and `setText` both end with `\n`;
    verify the remaining call sites (`succeed`, `fail`, `finish`,
    non-interactive branch) also always end with `\n`
  - In verbose mode: confirm `ThinkingDelta` stream ends with `\n\n` via
    `endThinking` before any subsequent message is written
  - Tests: for each renderer method (`setText`, `setTextWithCursor`, `succeed`,
    `fail`, `finish`), add or strengthen assertions that the output string ends
    with `\n` before the next method's content begins — both in `verbose=true`
    and `verbose=false` branches

- [x] Fix non-interactive `BuildRenderer.setTextWithCursor` to emit a trailing
      newline
  - Currently it calls `console.log` (which adds `\n`), so no change needed —
    but add an explicit test to lock this in
  - Tests: assert that consecutive non-interactive `setTextWithCursor` calls
    produce separate lines in `console.log` output

## Learnings

- Always call `handler.ensureNewline()` before writing any new line to stdout,
  even if the previous write was supposed to end with `\n` — double-checking
  prevents silent concatenation bugs when control flow bypasses the expected
  exit path
- When removing a timer-based effect (e.g., blinking cursor), also remove the
  `HIDE_CURSOR` write that preceded it; a hidden cursor with no restore call
  leaves the terminal in a broken state
