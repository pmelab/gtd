build(release): add semantic-release deps and config

Install semantic-release with the git, github, and exec plugins as dev
dependencies and add a .releaserc.json that releases from main: exec writes
the next version into package.json and builds, git commits the bump back, and
github publishes a release with the gtd.bundle.mjs asset. No @semantic-release/npm
since the package is private and unpublished.
