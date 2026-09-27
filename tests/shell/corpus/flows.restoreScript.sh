#!/usr/bin/env sh
set +e
git diff --quiet 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' -- 'src/a.ts' && git restore --source='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa~1' --worktree -- 'src/a.ts'
git diff --quiet 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' -- 'it'\''s here.ts' && git restore --source='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa~1' --worktree -- 'it'\''s here.ts'
git diff --quiet 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' -- 'src/new.ts' && rm -f -- 'src/new.ts'
