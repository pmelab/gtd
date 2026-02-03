#!/usr/bin/env bats

load '../../node_modules/bats-support/load'
load '../../node_modules/bats-assert/load'
load helpers/setup

setup_file() {
  build_gtd
  create_test_project

  # Create a simple TODO.md
  cd "$TEST_REPO"
  cat >TODO.md <<'EOF'
- add a `multiply` function to `src/math.ts` that multiplies two numbers
- add a test for the `multiply` function in `tests/math.test.ts`
EOF
  git add TODO.md
  git commit -q -m "add TODO.md"
}

teardown_file() {
  if [[ "${KEEP_TEST_REPO:-}" != "1" ]]; then
    remove_test_project
  else
    echo "# Test repo preserved at: $TEST_REPO" >&3
  fi
}

# ── Plan ────────────────────────────────────────────────────────────────────

@test "gtd plan rewrites TODO.md with action items" {
  run_gtd plan

  assert_success

  # TODO.md should now have checkboxes
  run repo_file TODO.md
  assert_success
  assert_output --partial "- [ ]"
}

@test "gtd plan committed changes" {
  cd "$TEST_REPO"
  run git log --oneline -1
  assert_output --partial "plan:"
}

# ── Build ───────────────────────────────────────────────────────────────────

@test "gtd build implements action items" {
  run_gtd build

  assert_success
}

@test "multiply function exists after build" {
  run repo_file src/math.ts
  assert_success
  assert_output --partial "multiply"
}

@test "multiply test exists after build" {
  run repo_file tests/math.test.ts
  assert_success
  assert_output --partial "multiply"
}

@test "all tests pass after build" {
  cd "$TEST_REPO"
  run bun test
  assert_success
}

@test "TODO.md items are checked off after build" {
  run repo_file TODO.md
  assert_success
  assert_output --partial "- [x]"
}

@test "build created commits" {
  cd "$TEST_REPO"
  local count
  count=$(git rev-list --count HEAD)
  # initial + todo + plan + at least one build commit
  [[ "$count" -ge 4 ]]
}

# ── Learn ───────────────────────────────────────────────────────────────────

@test "gtd learn extracts learnings" {
  # Only run if there's a Learnings section
  cd "$TEST_REPO"
  if ! grep -qi "## Learnings" TODO.md 2>/dev/null; then
    skip "no Learnings section in TODO.md"
  fi

  run_gtd learn

  assert_success
}

@test "TODO.md is removed after learn" {
  cd "$TEST_REPO"
  if ! grep -qi "## Learnings" TODO.md 2>/dev/null; then
    skip "learn was skipped"
  fi

  run repo_file_exists TODO.md
  assert_failure
}
