## Task: Extract `TODO:` markers into `TODO.md`

The diff contains added or modified lines with `TODO:` comments. Treat each one
as a planning note that belongs in `TODO.md`, not in source code.

1. For every `TODO:` comment in the diff, read enough surrounding code to
   describe the work concretely.
2. If `TODO.md` does not exist, create it with a `## Action Items` section.
3. Append each `TODO:` as an unchecked item under `## Action Items`:

   ```markdown
   - [ ] <concrete description> (was `TODO:` in `path/to/file.ts`)
   ```

4. Remove the `TODO:` comment from the source code.
5. Commit `TODO.md` + the source cleanup together with `docs: capture TODO
   markers in TODO.md`.

This task runs **before** the "Commit uncommitted code changes" task above if
both apply: extract markers first, then group what remains.
