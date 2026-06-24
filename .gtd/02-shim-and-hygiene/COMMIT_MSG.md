feat(launcher): replace committed bundle with download-on-first-use shim

scripts/gtd.js was an 18.5 MB bundle committed to the repo. Replace it with a
tiny dependency-free Node launcher shim that resolves the real bundle at
scripts/gtd.bundle.mjs, downloading it from the latest GitHub release on first
use (atomic write + chmod) and importing it offline thereafter. On download
failure it prints the manual fallback URL and the npm run build hint, then
exits non-zero.

The shim keeps the scripts/gtd.js entrypoint path, so SKILL.md and all prompts
that invoke `node scripts/gtd.js [format <file>]` keep working verbatim.

Git/tooling hygiene moves with it: the generated bundle (scripts/gtd.bundle.mjs)
and its temp file are gitignored, and the prettier-ignore / linguist-generated
diff suppression now target the bundle so the hand-written shim is formatted and
diffed normally.
