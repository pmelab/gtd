build(bundle): output to dist/ and copy bundle next to shim

Move the tsup build output from scripts/gtd.js to dist/gtd.bundle.mjs so the
committed launcher shim (added in a later package) is never wiped by tsup's
clean: true. A postbuild script copies the bundle to scripts/gtd.bundle.mjs for
local dev, and a pretest:e2e build step keeps the cucumber suite offline and
deterministic.
