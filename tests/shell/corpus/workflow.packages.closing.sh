#!/usr/bin/env sh
# Removes the just-reviewed package file plus leftover spec
# feedback/evidence, so the item's own diff doesn't litter the
# process's final `gtd summary` range. Reached only on spec-review
# approval — that loop carries no retry cap, so there is no
# force-close path here.
set +e
pkg="undefined"
[ -n "$pkg" ] && rm -f "$pkg"
rm -f .gtd/SPEC_FEEDBACK.md .gtd/SPEC_SCOPE.md .gtd/SPEC_CLEARED.md .gtd/SATISFIED.md
