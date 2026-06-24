ci(release): publish bundle on v* tags and document the flow

Add .github/workflows/release.yml: on v* tags it reuses the Test workflow as a
gate, builds dist/gtd.bundle.mjs, and creates a GitHub release with the bundle
uploaded as gtd.bundle.mjs (the asset the launcher shim downloads). The release
job runs with contents: write permission.

Update the README Development section to describe the new build output
(dist/gtd.bundle.mjs), the download-on-first-use launcher shim, and a Releasing
note: tag vX.Y.Z, push, CI builds and uploads the bundle.
