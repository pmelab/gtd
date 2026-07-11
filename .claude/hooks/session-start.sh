#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

npm install

# e2e tests spawn real git repos; mirror the CI git identity so commits succeed.
git config --global user.email "ci@gtd.test"
git config --global user.name "CI"
git config --global init.defaultBranch main
