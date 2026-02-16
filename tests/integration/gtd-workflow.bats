#!/usr/bin/env bats

load '../../node_modules/bats-support/load'
load '../../node_modules/bats-assert/load'
load helpers/setup

setup_file() {
  build_gtd
  create_test_project

  # Create a rough TODO.md with a feature request
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

# Helper: get last commit message prefix (first character/emoji)
last_commit_prefix() {
  cd "$TEST_REPO"
  git log -1 --format="%s" | head -c4
}

# Helper: get git log (one-line format)
git_log() {
  cd "$TEST_REPO"
  git log --oneline
}

# ── Step 2: First gtd → plan ────────────────────────────────────────────────

@test "gtd plans from initial TODO" {
  run_gtd

  assert_success

  # TODO.md should now have checkboxes
  run repo_file TODO.md
  assert_success
  assert_output --partial "- [ ]"

  # Last commit should be a plan commit (🤖)
  run last_commit_prefix
  assert_output "🤖"
}

# ── Steps 3-4: Human edits → commit-feedback → re-plan ──────────────────────

@test "gtd commits feedback and re-plans" {
  cd "$TEST_REPO"

  # Simulate human feedback: add blockquote + small formatting fix
  cat >>TODO.md <<'EOF'

> please also add error handling for non-numeric inputs
EOF
  # Also make a small direct formatting fix (extra newline in source)
  printf '\n' >>src/math.ts

  run_gtd

  assert_success

  # Blockquote should be removed from TODO.md (incorporated into plan)
  run repo_file TODO.md
  assert_success
  refute_output --partial "> please also add"

  # Should have fix (👷) or feedback (🤦) commits in the log
  run git_log
  assert_output --regexp "(👷|🤦)"

  # Last commit should be plan (🤖) since re-dispatch runs plan after commit-feedback
  run last_commit_prefix
  assert_output "🤖"
}

# ── Steps 5-6: gtd → build ──────────────────────────────────────────────────

@test "gtd builds action items" {
  run_gtd

  assert_success

  # multiply function should exist
  run repo_file src/math.ts
  assert_success
  assert_output --partial "multiply"

  # Tests should pass
  cd "$TEST_REPO"
  run bun test
  assert_success

  # Items should be checked off
  run repo_file TODO.md
  assert_success
  assert_output --partial "- [x]"

  # Last commit should be build (🔨)
  run last_commit_prefix
  assert_output "🔨"
}

# ── Steps 7-8: Post-build feedback (code fix + // TODO + blockquote) ─────────

@test "gtd handles post-build feedback" {
  cd "$TEST_REPO"

  # Add a // TODO comment in source expressing a general guideline
  sed -i '' '1i\
// TODO: never use magic numbers, always use named constants
' src/math.ts

  # Add blockquote feedback in TODO.md
  cat >>TODO.md <<'EOF'

> please add a subtract function too
EOF

  # Make a small direct code fix
  printf '// fixed\n' >>src/math.ts

  run_gtd

  assert_success

  # Blockquote should be removed
  run repo_file TODO.md
  assert_success
  refute_output --partial "> please add a subtract"

  # Should have new unchecked action item (from TODO comment or blockquote)
  assert_output --partial "- [ ]"

  # Last commit should be plan (🤖)
  run last_commit_prefix
  assert_output "🤖"
}

# ── Step 9: gtd → build (second cycle) ──────────────────────────────────────

@test "gtd builds again after feedback" {
  run_gtd

  assert_success

  # Tests should still pass
  cd "$TEST_REPO"
  run bun test
  assert_success

  # Last commit should be build (🔨)
  run last_commit_prefix
  assert_output "🔨"
}

# ── Steps 10-11: Human removes learning → commit-feedback → learn → cleanup ─

@test "gtd learns and cleans up" {
  cd "$TEST_REPO"

  # Only run learn flow if there's a Learnings section
  if ! grep -qi "## Learnings" TODO.md 2>/dev/null; then
    skip "no Learnings section in TODO.md"
  fi

  # Simulate human removing a learning line (leave uncommitted)
  sed -i '' '/magic numbers/d' TODO.md

  run_gtd

  assert_success

  # AGENTS.md should have been updated with learnings
  run repo_file_exists AGENTS.md
  assert_success

  # Learn (🎓) and cleanup (🧹) should appear in log
  run git_log
  assert_output --regexp "🎓"
  assert_output --regexp "🧹"
}

@test "TODO.md is removed after learn" {
  # learnAction chains: 🎓 persist → 🧹 remove TODO.md, so it's already gone
  run repo_file_exists TODO.md
  assert_failure
}

# ── Idle ─────────────────────────────────────────────────────────────────────

@test "gtd is idle when done" {
  run_gtd

  assert_success
  assert_output --partial "Nothing to do"
}
