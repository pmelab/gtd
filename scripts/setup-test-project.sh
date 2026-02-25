#!/usr/bin/env bash
set -euo pipefail

TEST_DIR="test"

if [ -d "$TEST_DIR/.git" ]; then
  echo "Test project already exists, skipping."
  exit 0
fi

echo "Setting up test project in $TEST_DIR/ ..."

mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

git init

cat > package.json << 'PKGJSON'
{
  "name": "calculator-cli",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
PKGJSON

echo "node_modules" > .gitignore

cat > mise.toml << 'MISE'
[env]
_.path = ["../dist"]
MISE

mkdir -p src tests

cat > src/calculator.ts << 'SRC'
export function add(a: number, b: number): number {
  return a + b;
}
SRC

cat > tests/calculator.test.ts << 'TEST'
import { describe, it, expect } from "vitest";
import { add } from "../src/calculator";

describe("calculator", () => {
  it("should add two numbers", () => {
    expect(add(1, 2)).toBe(3);
  });
});
TEST

cat > .gtdrc.json << 'RC'
{
  "modelPlan": "anthropic/sonnet",
  "modelBuild": "anthropic/sonnet",
  "modelCommit": "anthropic/haiku"
}
RC

npm install

git add -A
git commit -m "initial project setup"

cat > TODO.md << 'TODO'
# TODO

Build a calculator CLI tool.

## Action items

- [ ] Implement add operation
- [ ] Implement subtract operation
- [ ] Implement multiply operation
- [ ] Implement divide operation (handle division by zero)
- [ ] Create CLI interface that reads from stdin
TODO

echo "Test project ready at $TEST_DIR/"
