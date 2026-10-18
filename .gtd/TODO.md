Fix PR 391 review 2: 1 READ_ONLY_GIT must reject quoted or backslash-escaped
flags like a quoted --output. 2 a one-slice stack-mode ship on a recorded stack
resumes it, not unstacks. 3 resume drops merged slices before topGuard, chain
and rebuild. 4 pullRequest and preview use viewPr, no raw JSON.parse. 5 delete
the done 15386cd note from TODO.md, keep the other notes
