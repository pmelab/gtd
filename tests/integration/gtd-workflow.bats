#!/usr/bin/env bats

load '../../node_modules/bats-support/load'
load '../../node_modules/bats-assert/load'
load helpers/setup

setup_file() {
  build_gtd
  create_test_project

  # Add a second empty commit so HEAD~1 exists (needed for getDiff fallback)
  cd "$TEST_REPO"
  git commit --allow-empty -q -m "chore: setup"
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

# ── Step 1: Seed → plan ─────────────────────────────────────────────────────

@test "gtd seeds new TODO with 🌱 and plans with 🤖" {
  cd "$TEST_REPO"

  # Create a new TODO.md and stage it (so getDiff sees it via HEAD~1 fallback)
  cat >TODO.md <<'EOF'
- add a `multiply` function to `src/math.ts` that multiplies two numbers
- add a test for the `multiply` function in `tests/math.test.ts`
EOF
  git add TODO.md

  run_gtd

  assert_success

  # Git log should contain a 🌱 seed commit
  run git_log
  assert_output --partial "🌱"

  # TODO.md should now have checkboxes (plan ran after seed)
  run repo_file TODO.md
  assert_success
  assert_output --partial "- [ ]"

  # Last commit should be a plan commit (🤖) — seed triggers plan
  run last_commit_prefix
  assert_output "🤖"
}

# ── Step 2: Feedback → re-plan ──────────────────────────────────────────────

@test "gtd commits blockquote feedback with 💬 and re-plans with 🤖" {
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

  # Should have 💬 feedback commit in the log (blockquote classified as feedback)
  run git_log
  assert_output --partial "💬"

  # Should also have 👷 fix commit (formatting fix in code)
  assert_output --partial "👷"

  # Last commit should be plan (🤖) since re-dispatch runs plan after feedback
  run last_commit_prefix
  assert_output "🤖"
  # TODO: also assert that there is a new action item in TODO.md
}

# ── Step 3: gtd → build ─────────────────────────────────────────────────────

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

# ── Step 4: Post-build feedback with code TODOs (🤦) ────────────────────────

@test "gtd commits code TODOs with 🤦 prefix" {
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

  # In-code TODO comment should be removed from source file
  run repo_file src/math.ts
  assert_success
  refute_output --partial "// TODO: never use magic numbers"

  # Blockquote should be removed
  run repo_file TODO.md
  assert_success
  refute_output --partial "> please add a subtract"

  # Should have 🤦 human TODO commit in the log (code TODO markers)
  run git_log
  assert_output --partial "🤦"

  # Should also have 💬 feedback commit (blockquote)
  assert_output --partial "💬"

  # Should have new unchecked action item (from TODO comment or blockquote)
  run repo_file TODO.md
  assert_output --partial "- [ ]"

  # Last commit should be plan (🤖)
  run last_commit_prefix
  assert_output "🤖"
}

# ── Step 5: gtd → build (second cycle) ──────────────────────────────────────

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

# ── Step 6: Human removes learning → commit-feedback → learn → cleanup ──────

@test "gtd learns and cleans up" {
  cd "$TEST_REPO"

  # Only run learn flow if there's a Learnings section
  if ! grep -qi "## Learnings" TODO.md 2>/dev/null; then
    skip "no Learnings section in TODO.md"
  fi

  # Ensure at least one learning survives after sed removes "magic numbers"
  printf '\n- always validate inputs at system boundaries\n' >> TODO.md

  # Simulate human removing a learning line (leave uncommitted)
  # Scope to ## Learnings section only — "magic numbers" may also appear in action items
  sed -i '' '/^## Learnings$/,/^## /{ /magic numbers/d; }' TODO.md

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
