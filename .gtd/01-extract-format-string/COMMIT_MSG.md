refactor(gtd): extract pure formatString from Format.ts

Add a pure, FileSystem-free `formatString(content): Effect<string, Error>`
that runs prettier with the existing `PRETTIER_CONFIG`, and refactor
`formatFile` to read-then-delegate while preserving its not-found warning,
skip-on-error, and write-only-when-changed behavior.

This is the foundation for the in-memory REVIEW.md normalization used by the
upcoming markerless `reviewHasRealFeedback` classifier.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
