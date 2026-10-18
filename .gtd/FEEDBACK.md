> @pmelab/gtd@29.1.0 test jiti scripts/test-states.main.ts

• turbo 2.10.9 test-states: defaults — pass • turbo 2.10.9 test-states:
naive_pass on — pass • turbo 2.10.9 test:unit: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/fix-373-guard-empty-packages/)
/Users/pmelab/.herdr/worktrees/gtd/fix-373-guard-empty-packages/node_modules/.bin/npm
run test:unit exited (1) ERROR run failed: command exited (1)

• Running test:unit, test:workflows, test:e2e:inmem, test:e2e:live, test:web •
Remote caching disabled, using shared worktree cache

test:unit: cache miss, executing 0f5defd451398700 test:unit: test:unit: >
@pmelab/gtd@29.1.0 test:unit test:unit: > vitest run --project unit test:unit:
test:unit: fatal: path 'missing.txt' does not exist in 'HEAD' test:unit: fatal:
invalid object name 'HEAD'. test:unit: warning: adding embedded git repository:
sub test:unit: hint: You've added another git repository inside your current
repository. test:unit: hint: Clones of the outer repository will not contain the
contents of test:unit: hint: the embedded repository and will not know how to
obtain it. test:unit: hint: If you meant to add a submodule, use: test:unit:
hint: test:unit: hint: git submodule add <url> sub test:unit: hint: test:unit:
hint: If you added this path by mistake, you can remove it from the test:unit:
hint: index with: test:unit: hint: test:unit: hint: git rm --cached sub
test:unit: hint: test:unit: hint: See "git help submodule" for more information.
test:unit: hint: Disable this message with "git config set
advice.addEmbeddedRepo false" test:unit: Generating a 2048 bit RSA private key
test:unit: .........+++++ test:unit: ....................................+++++
test:unit: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-9GFTRV/key.pem'
test:unit: ----- test:unit: (node:73098) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: Finished in 277ms on 1 files using 10 threads. test:unit: Finished in
252ms on 1 files using 10 threads. test:unit: Finished in 254ms on 1 files using
10 threads. test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-tHChKn
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two

Tasks: 4 successful, 6 total Cached: 3 cached, 6 total Time: 3m2.801s Failed:
//#test:unit

test-states: risk_tier on — FAIL

<!-- gtd check 4bc5293 -->
