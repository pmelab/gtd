> @pmelab/gtd@29.1.0 test jiti scripts/test-states.main.ts

• turbo 2.10.9 test:unit: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/fix-373-guard-empty-packages/)
/Users/pmelab/.herdr/worktrees/gtd/fix-373-guard-empty-packages/node_modules/.bin/npm
run test:unit exited (1) ERROR run failed: command exited (1)

• Running format:check, typecheck, lint, lint:sh, lint:boundaries, test:unit,
test:workflows, test:e2e:inmem, test:e2e:live, test:web, analyze • Remote
caching disabled, using shared worktree cache

test:unit: cache miss, executing 61f74e0c54b5cca5 test:unit: test:unit: >
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
test:unit: ............+++++ test:unit: .......+++++ test:unit: writing new
private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-beI6wK/key.pem'
test:unit: ----- test:unit: Finished in 103ms on 1 files using 10 threads.
test:unit: Finished in 70ms on 1 files using 10 threads. test:unit: Finished in
102ms on 1 files using 10 threads. test:unit: (node:17782) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-sQhGNw
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two test:unit: test:unit:
FAIL requireDeclaredTests > groups an unwritten unmarked test and a missing
marked test in one refusal test:unit: expected -1 to be greater than or equal to
0 test:unit: AssertionError: expected -1 to be greater than or equal to 0
test:unit: test:unit: 1 test(s) failed

Tasks: 10 successful, 12 total Cached: 9 cached, 12 total Time: 1m55.517s
Failed: //#test:unit

test-states: defaults — FAIL • turbo 2.10.9 test:unit: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/fix-373-guard-empty-packages/)
/Users/pmelab/.herdr/worktrees/gtd/fix-373-guard-empty-packages/node_modules/.bin/npm
run test:unit exited (1) ERROR run failed: command exited (1)

• Running test:unit, test:workflows, test:e2e:inmem, test:e2e:live, test:web •
Remote caching disabled, using shared worktree cache

test:unit: cache miss, executing a32ea3f7f6fd727c test:unit: test:unit: >
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
test:unit: ................................................+++++ test:unit:
................+++++ test:unit: writing new private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-rRWoqg/key.pem'
test:unit: ----- test:unit: (node:62650) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: Finished in 60ms on 1 files using 10 threads. test:unit: Finished in
96ms on 1 files using 10 threads. test:unit: Finished in 106ms on 1 files using
10 threads. test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-ojKWrg
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two test:unit: test:unit:
FAIL requireDeclaredTests > groups an unwritten unmarked test and a missing
marked test in one refusal test:unit: expected -1 to be greater than or equal to
0 test:unit: AssertionError: expected -1 to be greater than or equal to 0
test:unit: test:unit: 1 test(s) failed

Tasks: 4 successful, 6 total Cached: 4 cached, 6 total Time: 2m17.328s Failed:
//#test:unit

test-states: naive_pass on — FAIL • turbo 2.10.9 test:unit: ERROR command
(/Users/pmelab/.herdr/worktrees/gtd/fix-373-guard-empty-packages/)
/Users/pmelab/.herdr/worktrees/gtd/fix-373-guard-empty-packages/node_modules/.bin/npm
run test:unit exited (1) ERROR run failed: command exited (1)

• Running test:unit, test:workflows, test:e2e:inmem, test:e2e:live, test:web •
Remote caching disabled, using shared worktree cache

test:unit: cache miss, executing e56740cc13133902 test:unit: test:unit: >
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
test:unit: ..............+++++ test:unit:
..............................................+++++ test:unit: writing new
private key to
'/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-tls-I6K5M1/key.pem'
test:unit: ----- test:unit: Finished in 85ms on 1 files using 10 threads.
test:unit: Finished in 55ms on 1 files using 10 threads. test:unit: Finished in
96ms on 1 files using 10 threads. test:unit: (node:17706) Warning: Setting the
NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections
and HTTPS requests insecure by disabling certificate verification. test:unit:
(Use `node --trace-warnings ...` to show where the warning was created)
test:unit: From
/private/var/folders/jc/_7rqk0_s2n9gf8xv833xwrfh0000gn/T/gtd-git-tier-bare-f7vkTR
test:unit: * [new ref] refs/gtd/history/one -> refs/gtd/history/one test:unit: *
[new ref] refs/gtd/history/two -> refs/gtd/history/two test:unit: test:unit:
FAIL requireDeclaredTests > groups an unwritten unmarked test and a missing
marked test in one refusal test:unit: expected -1 to be greater than or equal to
0 test:unit: AssertionError: expected -1 to be greater than or equal to 0
test:unit: test:unit: 1 test(s) failed

Tasks: 4 successful, 6 total Cached: 4 cached, 6 total Time: 1m28.139s Failed:
//#test:unit

test-states: risk_tier on — FAIL

<!-- gtd check e60a824 -->
