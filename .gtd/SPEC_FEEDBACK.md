# Spec feedback — 02 shell safety and confinement

Tasks 2, 4, 5, 6, 7 are met. Two unchecked bullets remain, both in the
test/record layer, not in behaviour.

## Task 1 — the accepted `-subj` limitation is recorded nowhere

Bullet: "Accepted and recorded: a `host` containing `/` or `=` can still confuse
openssl's own `-subj` parsing. That is a failed certificate request with a named
error, not code execution."

`src/ui/Tls.ts` carries no such note — its doc comment covers the SAN/`ip`
literal rule only, and neither `Shell.ts` nor `Tls.test.ts` mentions it. Per
AGENTS.md a non-obvious constraint belongs at the code it constrains or in a
test. Record it at the `-subj` line in `src/ui/Tls.ts` (or as a `Tls.test.ts`
case asserting a `/`-bearing host yields a GtdError, never execution).

## Task 3 — the symlink refusal is asserted only at `resolveWithinRoot`

Bullet, and the spec's Acceptance section repeating it: "A unit test with a
symlink inside the root pointing outside it asserts the read AND the write both
refuse."

`src/ui/SafePath.test.ts:65,74` prove the shared function refuses a symlinked
file and a symlinked directory. No test drives that symlink through
`readSteeringFile` or `writeNote`: `ReadSteeringFile.test.ts:34` and
`Write.test.ts:82` both use the string path `../../../etc/passwd` with fake
deps, which the pre-existing `startsWith` check already caught. Add one
real-on-disk case per side — a symlink inside a tmp root pointing outside it,
asserted `file-vanished` from `readSteeringFile` and from `writeNote`.
