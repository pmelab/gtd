#!/usr/bin/env bash

_get_project_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd
}

PROJECT_ROOT="$(_get_project_root)"
GTD_BIN="${PROJECT_ROOT}/dist/gtd"

# Build gtd before running tests
build_gtd() {
  cd "$PROJECT_ROOT" || return 1
  bun run build
}

# Create a minimal test project in a temp directory
create_test_project() {
  export TEST_REPO
  TEST_REPO="$(mktemp -d)"

  cd "$TEST_REPO" || return 1

  # Git setup
  git init -q
  git config user.name "Test"
  git config user.email "test@test.com"

  # Minimal bun project
  cat >package.json <<'EOF'
{
  "name": "test-project",
  "scripts": {
    "test": "bun test"
  }
}
EOF

  # Source file with one function
  mkdir -p src
  cat >src/math.ts <<'EOF'
export const add = (a: number, b: number): number => a + b
EOF

  # Test file
  mkdir -p tests
  cat >tests/math.test.ts <<'EOF'
import { expect, test } from "bun:test"
import { add } from "../src/math.js"

test("add returns sum of two numbers", () => {
  expect(add(2, 3)).toBe(5)
})
EOF

  # Initial commit
  git add -A
  git commit -q -m "initial commit"
}

# Run gtd in the test repo
# In verbose mode (GTD_E2E_VERBOSE=1), output streams live to the terminal
run_gtd() {
  cd "$TEST_REPO" || return 1
  if [[ "${GTD_E2E_VERBOSE:-}" == "1" ]]; then
    echo "# ── Running: gtd $* ──" >&3
    GTD_TEST_CMD="bun test" env -u CLAUDECODE "$GTD_BIN" "$@" >&3 2>&3
    status=$?
    output=""
    echo "# ── exit code: $status ──" >&3
  else
    GTD_TEST_CMD="bun test" run env -u CLAUDECODE "$GTD_BIN" "$@"
  fi
}

# Get contents of a file in the test repo
repo_file() {
  cat "${TEST_REPO}/$1"
}

# Check if a file exists in the test repo
repo_file_exists() {
  [[ -f "${TEST_REPO}/$1" ]]
}

# Get git log in the test repo
repo_git_log() {
  cd "$TEST_REPO" || return 1
  git log --oneline
}

# Count commits in the test repo
repo_commit_count() {
  cd "$TEST_REPO" || return 1
  git rev-list --count HEAD
}

# Cleanup
remove_test_project() {
  if [[ -n "$TEST_REPO" && -d "$TEST_REPO" ]]; then
    rm -rf "$TEST_REPO"
  fi
}
