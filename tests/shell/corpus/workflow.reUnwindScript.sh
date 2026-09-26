#!/usr/bin/env sh
# Scoped revert of the human's review-round edit — .gtd/ excluded
# (the guard's isCodePath re-derives the same exemption; keep both
# in sync). Expected to succeed; requireRevert catches a silent
# apply failure.
set +e
# Hoisted here, at the TOP: Eta's autoTrim eats the newline after
# an interpolation tag, so no tag may be the last token on a line.
commit="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
patch=.gtd/.re-unwind.patch
mkdir -p .gtd
git diff --binary "$commit^" "$commit" -- . ":(exclude).gtd" > "$patch"
if [ -s "$patch" ]; then
  git apply -R "$patch" || echo "re-unwind: could not revert $commit" >&2
fi
rm -f "$patch"
