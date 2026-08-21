#!/usr/bin/env sh
# gtd check turn (the package queue arbiter) — the loop driver executes
# this verbatim, then steps the check actor. Mechanics only: take the
# first package file (by name) under the packages dir into NEXT.md, or
# remove NEXT.md when the queue is empty. What NEXT.md's presence/absence
# MEANS (another package to build vs. the queue closing out to review) is
# decided by this state's own `on` rules at capture time — never here.
set +e
mkdir -p .gtd
# Sweep the design/architecture phases' spent steering files:
# REQUIREMENTS.md is consumed by architecture.author, ARCHITECTURE.md
# by architecture.decompose, and QUESTIONS.md by whichever gate ran
# last — all three are gone by the time the package queue starts.
# REVIEW_RAW.md is swept here too: the review loop-back
# (re-unwind) excludes .gtd from its revert, so an actionable
# feedback round's MARKED raw capture (see humanReview's own
# `collecting` state) rides through design and architecture
# untouched — this is the ONLY sweeper on that path
# before the queue (and eventually the squash finale) would
# otherwise pick it up as stray content. No-op if already removed.
rm -f .gtd/REQUIREMENTS.md .gtd/ARCHITECTURE.md .gtd/QUESTIONS.md .gtd/REVIEW_RAW.md
# Package file names are gtd-authored (architecture.decompose writes
# NN-name.md), never containing whitespace/newlines that would break
# ls | head.
# shellcheck disable=SC2012
next=$(ls .gtd/packages/*.md 2>/dev/null | head -n 1)
if [ -n "$next" ]; then
  printf '%s' "$next" > .gtd/NEXT.md
else
  rm -f .gtd/NEXT.md
fi
