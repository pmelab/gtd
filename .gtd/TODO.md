# gtd ui: cannot tick a box in prReview's PR-CONFIRM.md (no option pre-ticked)

Closes pmelab/gtd#565 (https://github.com/pmelab/gtd/issues/565)

At `pr.confirm.gate` (prReview), `gtd ui` renders `.gtd/PR-CONFIRM.md` but the user cannot tick any of the event boxes.

File tail:
```
Tick exactly one event:

- [ ] COMMENT
- [ ] REQUEST_CHANGES
- [ ] APPROVE
```

Contrast: `REVIEW.md` at `pr.findings.gate` worked in the same session; there every "tick exactly one" group has one option pre-ticked (`- [x] fix as suggested`). Suspect the "exactly one" checkbox group in the UI only supports moving an existing tick, not setting the first one.

Seen 2026-11-05 on gtd main, phone/web client via tailscale. Workaround: edit the file by hand, then close the gate.
