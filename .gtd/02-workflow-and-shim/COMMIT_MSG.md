ci(release): drive releases via semantic-release and pin the shim

Rewrite the Release workflow to trigger on pushes to main and run
npx semantic-release with full git history, dropping the manual tag trigger
and gh release create steps. Update scripts/gtd.js to download the bundle for
the release matching its own package.json version, falling back to latest only
for the 0.0.0-development placeholder.
