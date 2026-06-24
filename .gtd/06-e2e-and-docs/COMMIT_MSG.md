docs(gtd): markerless review e2e features + README

Bring the e2e suite and docs in line with the markerless, edge-driven review
process.

- Rewrite the bang-harvest feature into a markerless feedback feature
  (`// !!` is now ordinary feedback) and update review.feature,
  spec-review-conclude.feature, and spec-verbatim-first.feature for the
  four-outcome routing (await-review / review-incomplete / close-review /
  review-process) and the slimmed, edge-driven review-process prompt.
- README: drop every `!!` reference, add the `review-incomplete` leaf (table +
  mermaid), retable close-review/review-process, and replace the `!!` prose with
  the "any change is feedback" global/local/suggestion taxonomy and the
  edge-driven record → capture → revert → close description.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
