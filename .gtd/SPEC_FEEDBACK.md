# Spec feedback — 01-worktree-head-token

## Task 3's "renders no retry control" assertion is vacuous

`src/web/screens/Plan.stories.tsx#RealContainerRendersHeadUnresolvedWithNoRetry`
and
`src/web/screens/Review.stories.tsx#RealContainerRendersHeadUnresolvedWithNoRetry`
both assert absence with:

    expect(canvas.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument()

The control this is meant to exclude is `RefusalBanner`'s button, whose
accessible name is `Try again` (`src/web/Refusal.tsx#187`) — `/retry/i` never
matches it. `refusal-retry` is a `data-testid`, not an accessible name. The
query matches nothing regardless of what renders, so the criterion "renders no
retry control" is not actually verified: the story would stay green if a
`Try again` button appeared on the `head-unresolved` screen.

Match what the banner actually renders — `queryByTestId("refusal-retry")`, or
`queryByRole("button", { name: /try again/i })` — in both stories.

Everything else in the package checks out: the `commondir` resolution, the
`head-unresolved` refusal and its router mapping, `withStaleShaRetry`'s one-shot
`sha`-only retry and its wiring in both containers, the banner's `Try again`
control, and the "reload"-free sentences. `test:unit` (2103), `test:web` (114),
`format:check`, `lint` and `tsc --noEmit` all pass, and `liveHeadSha` resolves
correctly in a real linked worktree.
