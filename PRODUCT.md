# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One developer (the person who wrote the workflow) supervising several AI-agent
worktrees across several projects. Mostly on a phone over the tailnet, in short
sessions between other things: answer a gate, review a change hunk by hunk,
proceed or retry a stuck worktree. Second, a desktop browser at the desk, with
many worktrees open at once.

## Product Purpose

gtd derives an agentic workflow from git history. Its web UI (`gtd ui`,
`gtd workspace`) is where the person acts at the steps only a human can take:
gate pages (requirements, design, review with the by-hunk view, squash message)
and the workspace dashboard (Now, Projects, Inbox, worktree detail). Success:
the person sees at once what needs them, decides, and gets back to their day.

## Positioning

The state lives in commits, not chat. Every press, note and answer becomes git
history that survives a crash or a week away. The UI shows a process's rest
point and the decision it waits for, never a conversation.

## Operating Context

- Served over the tailnet (`tailscale serve`); auth is tailnet identity.
- Notifications link straight to a worktree (`?worktree=`) or a gate page.
- Glossary terms are binding: workflow, step, gate, worktree, driver, proceed,
  retry, note, hunk. See GLOSSARY.md.

## Capabilities and Constraints

- React 19, Tailwind 4, Vite; Storybook covers every screen and state.
- Issue #633: rebuild with shadcn/ui components; every screen works at 360 px
  and 1440 px, no page-level horizontal scroll (code and diff blocks scroll in
  their own box), touch targets at least 44 px on mobile; same data, actions and
  routes; existing tests stay green.
- Light and dark theme follow the system setting.

## Brand Commitments

- Base palette (from #633): charcoal `#151A1D`, yellow `#FFC328`, white
  `#FAFAF7`, muted `#C9CBCD`. They remain the identity. Derived tints and
  dedicated status hues (error first) may be added; this amends #633's "only
  these four" rule (confirmed 2026-11-19).
- Code and diff blocks carry their own syntax and diff colours.
- Status must also read by shape or text, never by colour alone.

## Product Principles

1. What needs the person comes first; everything else folds away.
2. One decision at a time, with one obvious primary action.
3. Show the process in gtd's own words, never internals (raw URLs, config keys,
   error codes) without a plain sentence first.
4. Phone first; the desktop gets a real layout, not a stretched phone.

## Accessibility & Inclusion

WCAG AA contrast in both themes. Status, diff additions and deletions never rely
on colour alone.
