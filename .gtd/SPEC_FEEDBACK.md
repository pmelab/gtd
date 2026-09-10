# Feedback — 02 Remove the dictate button

All three tasks' checkboxes verify green: `Mic.tsx`/`Mic.stories.tsx` gone, no
`SpeechRecognition`/`onDictate` under `src/web/`, footer is `justify-end` with a
single child, `#65`'s overload intact and re-pointed at the refusal-revert
`.catch`, both pinned help copies re-worded to the tailnet policy, and
`typecheck`/`lint`/`deadcode`/`test:web`/`npm test` all pass.

Three stale comments still assert the deleted feature as live fact. The spec's
requirement is explicit that the Web Speech secure-context reason "is false the
moment `Mic` is deleted" — it was corrected in `src/Cli.ts` and `docs/cli.md`
but left standing in three other places.

## 1. `src/ui/Server.ts:171`–`174` still gives the deleted false reason

The comment justifying unconditional `https.createServer` reads:

    because the Web Speech API is secure-context-only and would lose dictation
    silently over plain http.

This is the exact sentence the package exists to retire, verbatim, in code that
is the actual enforcement point of the HTTPS-only rule. Restate it as the same
policy the help text now carries — a phone client reachable over a tailnet gets
TLS on its own merits — and invent no replacement technical justification.

## 2. `src/ui/Tls.ts:34`–`37` attributes the `-addext` flags to Web Speech

    the three `-addext` flags are each load-bearing for iOS's Web Speech API
    secure-context check

The flags stay (cert machinery is untouched per spec), but their stated purpose
is now dead: they are load-bearing for iOS trusting the leaf at all, not for a
secure-context check that no longer runs. Re-point the reason at iOS cert trust;
keep the three specifics (SAN with the bind IP, `serverAuth` EKU, critical
non-CA basic constraint).

## 3. `src/web/screens/Question.tsx:119` still describes a mic in the row

    /** One option row — a radio, its label, and (only for the free-text slot) the textarea+mic. */

`OptionRow` renders no mic. Drop the `+mic`. This is inside the file and the
component Task 1 edited, so it should have gone with the wrapper.

Nothing else. Do not touch the `#65` overload, the footer classes, the help
wording, or `src/web/generated.html`.
