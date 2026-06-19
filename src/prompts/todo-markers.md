## Task: Move `TODO:` markers into `TODO.md`

The diff contains added or modified lines with `TODO:` comments. Move every
new `TODO:` from the diff into `TODO.md` and remove it from the source. If
`TODO.md` does not exist yet, create it.

### Steps

1. **Extract markers** — For each `TODO:` comment in the diff, add an entry
   to `TODO.md` with enough context (file, function, what needs to be done).

2. **Remove markers from source** — Delete the `TODO:` comments from the
   source files.

3. **Run tests** — Determine the test command from project configuration
   (AGENTS.md, `package.json` scripts, etc.). Run the tests to verify the
   marker removal didn't break anything.

4. **Fix failures** — If tests fail, fix the issues. Loop until tests pass.

5. **Commit source changes only** — Commit the source file changes (marker
   removal) but **do not commit `TODO.md`**. Leave it uncommitted.

The uncommitted `TODO.md` will trigger the planning phase on the next cycle,
where it will be developed into a proper plan and eventually decomposed into
work packages.

Do this **before** the "Commit the uncommitted changes" task below, if both
apply — but only commit the non-`TODO.md` changes.
