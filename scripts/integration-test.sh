#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Usage:
#   ./scripts/integration-test.sh                    # run with auto agent
#   GTD_AGENT=pi ./scripts/integration-test.sh       # run with pi
#   KEEP_TEST_REPO=1 ./scripts/integration-test.sh   # preserve temp repo
#   ./scripts/integration-test.sh --verbose           # show agent output

for arg in "$@"; do
  case "$arg" in
    --verbose) export GTD_E2E_VERBOSE=1 ;;
  esac
done

cd "$PROJECT_ROOT"
exec npx cucumber-js --config tests/integration/cucumber.mjs "$@"
