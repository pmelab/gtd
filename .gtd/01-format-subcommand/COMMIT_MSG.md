feat(format): add bundled `format` subcommand

Ship `gtd format <file>` that runs a bundled prettier with a fixed
markdown style (printWidth 80, proseWrap always) so TODO.md / REVIEW.md
can be normalised in any host repo without depending on the host's
prettier install or `.prettierrc`. Prettier moves to `dependencies` so
tsup inlines it into `scripts/gtd.js`. Missing files and formatter
errors are best-effort: stderr warning, exit 0.
