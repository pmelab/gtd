Fix PR 393 review round 2: failureSignature must drop turbo boilerplate lines
(task: cache miss/bypass/hit lines and task: > command echo lines) so a failure
with no diagnostic output yields an empty signature and never collapses; add a
test with only boilerplate in two states
