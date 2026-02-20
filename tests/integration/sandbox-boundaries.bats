#!/usr/bin/env bats

load '../../node_modules/bats-support/load'
load '../../node_modules/bats-assert/load'
load helpers/setup

SANDBOX_CHECK="${PROJECT_ROOT}/tests/integration/helpers/sandbox-check.ts"

# ── Helpers ──────────────────────────────────────────────────────────────────

write_gtdrc() {
  local dir="$1"
  local content="$2"
  printf '%s' "$content" >"${dir}/.gtdrc.json"
}

run_sandbox_check() {
  local cwd="$1"
  local config="$2"
  local check_type="$3"
  local target="$4"
  local provider="${5:-pi}"
  run npx tsx "$SANDBOX_CHECK" "$cwd" "$config" "$check_type" "$target" "$provider"
}

assert_sandbox_violation() {
  assert_failure
  assert_output --partial "Sandbox violation"
}

# ── Setup / Teardown ────────────────────────────────────────────────────────

setup_file() {
  export SANDBOX_TEST_DIR
  SANDBOX_TEST_DIR="$(mktemp -d)"
  export SANDBOX_OUTSIDE_DIR
  SANDBOX_OUTSIDE_DIR="$(mktemp -d)"
}

teardown_file() {
  rm -rf "$SANDBOX_TEST_DIR" "$SANDBOX_OUTSIDE_DIR"
}

setup() {
  # Reset config to sandbox-enabled defaults before each test
  write_gtdrc "$SANDBOX_TEST_DIR" '{ "sandboxEnabled": true }'
}

# ── Network boundary ────────────────────────────────────────────────────────

@test "network: untrusted domain is denied by default" {
  run_sandbox_check "$SANDBOX_TEST_DIR" "${SANDBOX_TEST_DIR}/.gtdrc.json" \
    network "evil-api.example.com" claude

  assert_sandbox_violation
  assert_output --partial "evil-api.example.com"
  assert_output --partial "allowedDomains"
}

@test "network: config-driven escalation allows previously denied domain" {
  # Step 1: Verify denial
  run_sandbox_check "$SANDBOX_TEST_DIR" "${SANDBOX_TEST_DIR}/.gtdrc.json" \
    network "registry.npmjs.org" pi

  assert_sandbox_violation

  # Step 2: Update config to allow the domain
  write_gtdrc "$SANDBOX_TEST_DIR" '{
    "sandboxEnabled": true,
    "sandboxBoundaries": {
      "network": { "allowedDomains": ["registry.npmjs.org"] }
    }
  }'

  # Step 3: Re-run — should succeed
  run_sandbox_check "$SANDBOX_TEST_DIR" "${SANDBOX_TEST_DIR}/.gtdrc.json" \
    network "registry.npmjs.org" pi

  assert_success
  assert_output --partial "Access allowed"
}

@test "network: agent-essential domains are always allowed" {
  run_sandbox_check "$SANDBOX_TEST_DIR" "${SANDBOX_TEST_DIR}/.gtdrc.json" \
    network "api.anthropic.com" claude

  assert_success
}

# ── Filesystem write boundary ───────────────────────────────────────────────

@test "fs-write: path outside cwd is denied by default" {
  run_sandbox_check "$SANDBOX_TEST_DIR" "${SANDBOX_TEST_DIR}/.gtdrc.json" \
    write "${SANDBOX_OUTSIDE_DIR}/output.txt"

  assert_sandbox_violation
  assert_output --partial "$SANDBOX_OUTSIDE_DIR"
  assert_output --partial "allowWrite"
}

@test "fs-write: config-driven escalation allows previously denied path" {
  # Step 1: Verify denial
  run_sandbox_check "$SANDBOX_TEST_DIR" "${SANDBOX_TEST_DIR}/.gtdrc.json" \
    write "${SANDBOX_OUTSIDE_DIR}/output.txt"

  assert_sandbox_violation

  # Step 2: Update config to allow writing to the outside dir
  write_gtdrc "$SANDBOX_TEST_DIR" "{
    \"sandboxEnabled\": true,
    \"sandboxBoundaries\": {
      \"filesystem\": { \"allowWrite\": [\"${SANDBOX_OUTSIDE_DIR}\"] }
    }
  }"

  # Step 3: Re-run — should succeed
  run_sandbox_check "$SANDBOX_TEST_DIR" "${SANDBOX_TEST_DIR}/.gtdrc.json" \
    write "${SANDBOX_OUTSIDE_DIR}/output.txt"

  assert_success
  assert_output --partial "Access allowed"
}

@test "fs-write: path within cwd is allowed by default" {
  run_sandbox_check "$SANDBOX_TEST_DIR" "${SANDBOX_TEST_DIR}/.gtdrc.json" \
    write "${SANDBOX_TEST_DIR}/src/file.ts"

  assert_success
}

# ── Filesystem read boundary ────────────────────────────────────────────────

@test "fs-read: path outside cwd is denied by default" {
  run_sandbox_check "$SANDBOX_TEST_DIR" "${SANDBOX_TEST_DIR}/.gtdrc.json" \
    read "${SANDBOX_OUTSIDE_DIR}/data.txt"

  assert_sandbox_violation
  assert_output --partial "$SANDBOX_OUTSIDE_DIR"
  assert_output --partial "allowRead"
}

@test "fs-read: config-driven escalation allows previously denied path" {
  # Step 1: Verify denial
  run_sandbox_check "$SANDBOX_TEST_DIR" "${SANDBOX_TEST_DIR}/.gtdrc.json" \
    read "${SANDBOX_OUTSIDE_DIR}/data.txt"

  assert_sandbox_violation

  # Step 2: Update config to allow reading from the outside dir
  write_gtdrc "$SANDBOX_TEST_DIR" "{
    \"sandboxEnabled\": true,
    \"sandboxBoundaries\": {
      \"filesystem\": { \"allowRead\": [\"${SANDBOX_OUTSIDE_DIR}\"] }
    }
  }"

  # Step 3: Re-run — should succeed
  run_sandbox_check "$SANDBOX_TEST_DIR" "${SANDBOX_TEST_DIR}/.gtdrc.json" \
    read "${SANDBOX_OUTSIDE_DIR}/data.txt"

  assert_success
  assert_output --partial "Access allowed"
}

@test "fs-read: path within cwd is allowed by default" {
  run_sandbox_check "$SANDBOX_TEST_DIR" "${SANDBOX_TEST_DIR}/.gtdrc.json" \
    read "${SANDBOX_TEST_DIR}/src/file.ts"

  assert_success
}
