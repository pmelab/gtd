feat(prompts): instruct agent to run `gtd format` after editing TODO/REVIEW

Every prompt that writes or edits `TODO.md` / `REVIEW.md` now ends with
an explicit instruction to run `node scripts/gtd.js format <file>` using
the same `scripts/gtd.js` path the agent already invoked. This ensures
committed plan/review files are normalised by the bundled prettier
before the next gtd cycle sees them, with zero dependency on the host
repo's prettier install or `.prettierrc`.
