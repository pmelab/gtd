# Spec feedback — 02-remove-dictate-button

Tasks 1 and 2 are met. Task 3's wording is right; its wrapping is not.

## `src/Cli.ts#492` / `docs/cli.md#77` — the `ui` entry re-wrapped wider than the rest of the help

Task 3: "Re-wrap both sides to the same column width the surrounding lines use."
The rewritten block does not — it wraps 4–7 characters past every other command
in the same block.

Measured on `docs/cli.md`, lines 41–139:

- every line outside the `ui` entry: max 81 characters (one line at 81, two at
  80, the rest ≤79)
- the `ui` entry now: lines 78, 81, 82, 86 at 87 characters; 79 at 86; 85 at 86;
  80 at 83

The same over-wide strings are in `src/Cli.ts`'s `details` array, so the pin
holds and `npm test` stays green — nothing catches this but reading it.

Fix: re-wrap the `ui` `details` strings to ≤79 characters of rendered line
(prefix included), and mirror the identical break points into `docs/cli.md`. The
wording itself — "never plain http — a phone client reachable over a tailnet
gets TLS on its own merits" — is correct and must not change.
