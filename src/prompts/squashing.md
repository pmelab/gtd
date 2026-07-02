## Task: Squash all `gtd: *` commits into one conventional-commits message

The process is **approved and done**. The goal is to collapse every `gtd: *`
commit (and any interleaved non-gtd commits) in the feature range into a single,
clean conventional-commits message.

### Authoring the commit message

Spawn a **planning-model subagent** using model `{{MODEL}}` to author the
message. It must:

1. **Read the inlined full-process diff** — understand the totality of changes
   made during this feature branch.
2. **Draft ONE conventional-commits message** in the form:

   ```
   type(scope): subject

   optional body
   ```

   - **type**: `feat` / `fix` / `refactor` / `chore` / `docs` / `test`
   - **subject**: imperative mood, ≤ 72 characters, lowercase after the colon
   - **body** (optional): explain the _why_ — motivation, trade-offs, and
     context that won't be obvious from the diff alone. Omit if unnecessary.

### Squash commands

Run these commands **unconditionally** — squash the entire range, folding in any
interleaved non-gtd commits too. No guard, no abort:

```sh
git reset --soft <squashBase>
git commit -m "<generated message>"
```

Replace `<squashBase>` with the SHA on the `Squash base:` line and
`<generated message>` with the authored commit message. Run the commands
yourself — gtd's `src/` never performs the commit (same handoff pattern as
`clean.md`).

After committing, then re-run gtd to continue.
