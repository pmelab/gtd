#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Usage:
#   ./scripts/integration-test.sh                    # run with auto agent
#   GTD_AGENT=pi ./scripts/integration-test.sh       # run with pi
#   KEEP_TEST_REPO=1 ./scripts/integration-test.sh   # preserve temp repo
#   ./scripts/integration-test.sh --verbose           # show agent output
#   ./scripts/integration-test.sh --tap              # TAP output for CI

eval "$(mise activate bash)"

BATS_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --verbose)
      export GTD_E2E_VERBOSE=1
      BATS_ARGS+=(--show-output-of-passing-tests)
      ;;
    *)
      BATS_ARGS+=("$arg")
      ;;
  esac
done

exec bats "${PROJECT_ROOT}/tests/integration/gtd-workflow.bats" "${BATS_ARGS[@]}"
