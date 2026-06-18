# Plan: Integrate Matt Pocock's Skills into gtd

## Summary

Matt Pocock's [skills collection](https://github.com/mattpocock/skills/tree/main/skills) is a well-designed set of pi/Claude skills for engineering workflows. After analyzing both repos, there are several high-value integration opportunities that could significantly enhance gtd's planning, execution, and verification phases.

---

## Matt Pocock's Skills Inventory

### Engineering Skills (most relevant)

| Skill | What it does | gtd relevance |
|-------|-------------|---------------|
| **tdd** | Red-green-refactor with vertical slices, anti-horizontal-slicing rules | Already referenced in `execute.md`; could adopt its philosophy more deeply |
| **grilling** | One-question-at-a-time relentless interviewing | Direct competitor to `new-todo.md`/`modified-todo.md` |
| **grill-with-docs** | Grilling + domain-modeling (maintains CONTEXT.md/ADRs) | Enhanced planning with artifact production |
| **domain-modeling** | Build/maintain glossary (CONTEXT.md) and ADRs inline | gtd has no equivalent |
| **codebase-design** | Vocabulary: depth, seam, interface, adapter, leverage, locality | Could improve decompose and task file quality |
| **diagnosing-bugs** | 6-phase loop: feedback loop → reproduce → hypothesize → instrument → fix → postmortem | Far richer than gtd's `verify.md` |
| **improve-codebase-architecture** | HTML report of deepening opportunities | Could feed into planning phase |
| **to-prd** | Convert conversation to PRD with user stories, seams, testing decisions | Alternative output format to `.gtd/` |
| **to-issues** | Break PRD into vertical-slice GitHub issues | Alternative to `.gtd/` packages |
| **prototype** | Throwaway code for logic or UI questions | Useful during planning when questions need runnable answers |
| **review** | Two-axis review: Standards vs Spec | Could run after package execution |
| **triage** | Issue state machine: needs-triage → ready-for-agent → etc. | New capability for issue-driven workflow |
| **handoff** | Compact conversation for session boundary crossing | Useful for long planning sessions |
| **resolving-merge-conflicts** | Structured merge conflict resolution | Not a gtd phase but useful skill |

### Productivity Skills

- **grill-me**: Stateless grilling (no CONTEXT.md maintenance)
- **teach**: Multi-session learning with lessons/reference docs
- **writing-great-skills**: Meta-skill for writing skills

---

## Proposals

### 1. Replace gtd planning prompts with grilling-style interviewing

**Current state:** `new-todo.md` and `modified-todo.md` tell the planning model to "interview the plan relentlessly" and batch questions into `## Open Questions`.

**Matt's approach:** `grilling` asks questions **one at a time**, waiting for feedback before continuing. Combined with `domain-modeling`, it captures terminology in `CONTEXT.md` and architectural decisions in ADRs.

**Proposal:**
- Rewrite `new-todo.md` to invoke `/grilling` and `/domain-modeling` as the planning discipline
- Keep the `## Open Questions` format for async Q&A (user edits TODO.md, not live conversation)
- Add CONTEXT.md/ADR maintenance as side-effects of the planning phase
- Consider a "live mode" where gtd drives a conversational grilling session instead of batch editing

**Benefit:** More thorough plans, domain vocabulary captured, ADRs for hard-to-reverse decisions.

---

### 2. Adopt codebase-design vocabulary in decompose and task files

**Current state:** `decompose.md` tells the planning model to create packages with self-contained task files. No vocabulary for *how* to think about module boundaries.

**Matt's vocabulary:** module, interface, depth, seam, adapter, leverage, locality. The "deletion test" — would complexity vanish or reappear across callers?

**Proposal:**
- Add a section to `decompose.md` requiring the planning model to:
  - Identify seams at which each package operates
  - Apply the deletion test when grouping tasks
  - Use the shared vocabulary in task file descriptions
- Reference `codebase-design` skill or inline its key principles

**Benefit:** Better-structured work packages; tasks describe *where the seam is*, not just *what to build*.

---

### 3. Enhance verify phase with diagnosing-bugs discipline

**Current state:** `verify.md` says "verify the working tree is healthy. If broken, fix it." — no structure for how.

**Matt's approach:** 6-phase discipline: (1) build a tight feedback loop first, (2) reproduce + minimize, (3) hypothesize 3-5 ranked, (4) instrument, (5) fix + regression test, (6) cleanup + postmortem.

**Proposal:**
- Rewrite `verify.md` to:
  1. Run the test suite
  2. If failures exist, invoke `/diagnosing-bugs` discipline
  3. If all green, perform a quick sanity check (typecheck, lint)
- The key insight: "Build a feedback loop first" — without a repro, don't hypothesize

**Benefit:** Structured bug fixing instead of ad-hoc "fix it".

---

### 4. Add optional review phase after package execution

**Current state:** After tests pass, `execute.md` commits and moves on. No code review.

**Matt's approach:** `/review` runs two parallel sub-agents:
- **Standards axis:** Does the code follow documented coding standards?
- **Spec axis:** Does the code match what the originating issue/PRD asked for?

**Proposal:**
- Add optional `review` phase configurable in AGENTS.md
- If enabled, after tests pass but before commit:
  - Run `/review` against the package's COMMIT_MSG.md (as spec) and any CODING_STANDARDS.md
  - Report findings; ask user to proceed/fix
- Default: off (to preserve gtd's "keep moving" philosophy)

**Benefit:** Catch drift from spec and standards violations before commit.

---

### 5. Support issue-based workflow as alternative to .gtd/

**Current state:** gtd decomposes into `.gtd/` directories. Work is local, invisible to external tools.

**Matt's approach:** `/to-prd` creates a PRD with user stories, seams, testing decisions. `/to-issues` breaks it into GitHub issues with vertical slices and acceptance criteria.

**Proposal:**
- Add a config option: `gtd.decompose.target: "local" | "issues"`
- If `"issues"`:
  - `decompose.md` invokes `/to-prd` → `/to-issues` flow
  - Issues get `ready-for-agent` label
  - `execute.md` reads issues instead of `.gtd/` directories
  - Commits reference issue numbers
- If `"local"` (default): current `.gtd/` behavior

**Benefit:** Integration with GitHub Projects, external CI/CD, team visibility.

---

### 6. Invoke prototype during planning when questions need runnable answers

**Current state:** Planning is pure editing of TODO.md. No way to run code to answer a question.

**Matt's approach:** `/prototype` builds throwaway code to answer "does this logic feel right?" (terminal app) or "what should this look like?" (UI variations).

**Proposal:**
- When the planning model encounters a question that can't be resolved by reading code/docs:
  - Mark it with `<!-- needs-prototype: logic|ui -->`
  - On next `/gtd`, detect these markers and suggest invoking `/prototype`
  - Prototype answers feed back into TODO.md

**Benefit:** Some questions ("how should this state machine behave?") are only answerable by running code.

---

### 7. Add improve-codebase-architecture as a new entry point

**Current state:** gtd starts from a TODO.md sketch or uncommitted code. No way to say "find things to improve."

**Matt's approach:** `/improve-codebase-architecture` scans for friction, produces an HTML report of deepening opportunities, then grills through whichever one you pick.

**Proposal:**
- Add a new branch in `State.ts`: `architecture-review`
- Triggered by user creating a `.gtd-architecture-review` marker file (or similar)
- Runs `/improve-codebase-architecture`, outputs to TODO.md
- Then follows normal planning flow

**Benefit:** gtd can discover work, not just execute user-defined work.

---

### 8. Strengthen tdd integration in execute phase

**Current state:** `execute.md` says "inject the tdd skill" but doesn't specify the discipline.

**Matt's tdd skill:** Explicit red-green vertical slices, anti-horizontal-slicing warning, integration-style testing philosophy, supporting docs on good/bad tests and mocking.

**Proposal:**
- Update `execute.md` to reference Matt's tdd principles:
  - "Workers must use vertical slices: one test → one implementation → repeat"
  - "No horizontal slicing: don't write all tests first"
  - "Tests verify behavior through public interfaces, not implementation details"
- Consider bundling Matt's `tests.md` and `mocking.md` as task file preambles

**Benefit:** Consistent, high-quality tests from parallel workers.

---

### 9. Add handoff support for long planning sessions

**Current state:** Planning happens in one subagent invocation. If context fills, information is lost.

**Matt's approach:** `/handoff` compacts conversation into markdown, saved to temp dir. Next session references it.

**Proposal:**
- When planning model reaches ~80% context, auto-invoke `/handoff`
- Save to `.gtd/handoff-<timestamp>.md`
- Next `/gtd` detects handoff file and passes it to planning subagent
- Clean up after plan is finalized

**Benefit:** Arbitrarily long planning sessions without context loss.

---

## Implementation Order

1. **Phase 1 — Low-hanging fruit (enhances existing prompts):**
   - #3: Enhance verify with diagnosing-bugs discipline
   - #8: Strengthen tdd integration
   - #2: Adopt codebase-design vocabulary in decompose

2. **Phase 2 — Planning improvements:**
   - #1: Replace planning prompts with grilling-style + domain-modeling
   - #6: Prototype support for planning questions

3. **Phase 3 — New capabilities:**
   - #4: Optional review phase
   - #9: Handoff support for long sessions

4. **Phase 4 — Alternative workflows:**
   - #5: Issue-based workflow
   - #7: Architecture review entry point

---

## Open Questions

### Should gtd bundle Matt's skills or reference them externally?

**Recommendation:** Reference externally via `skills.sh`. Bundling creates maintenance burden; Matt's skills evolve independently. gtd prompts should say "invoke `/tdd`" not paste the skill content.

**Trade-off:** Users need Matt's skills installed (`npx skills add mattpocock/skills -g -y`). Could make this a documented prerequisite or auto-detect.

<!-- user answers here -->

---

### Should planning switch from batch Q&A to live grilling?

**Recommendation:** Keep batch Q&A as the default — it's async-friendly (user edits TODO.md offline). Add a `--live` mode that drives conversational grilling for users who want it.

**Trade-off:** Live mode means gtd controls the conversation flow, not just emits a prompt. Significant change to how gtd works (currently: emit prompt → agent follows it).

<!-- user answers here -->

---

### Should CONTEXT.md and ADRs be mandatory or optional?

**Recommendation:** Optional with encouragement. gtd should detect existing CONTEXT.md/docs/adr/ and maintain them if present. The planning prompt should *suggest* creating them but not block if the user doesn't want them.

**Trade-off:** If optional, planning quality varies. If mandatory, gtd becomes more opinionated than its current "coordinates phases, doesn't dictate strategy" philosophy.

<!-- user answers here -->

---

### What's the minimum viable integration for Phase 1?

**Recommendation:** Start with #3 (verify + diagnosing-bugs) because:
- It's a single prompt rewrite
- `verify.md` is currently the weakest prompt
- Measurable improvement: bugs get fixed more reliably

**Alternative:** Start with #8 (tdd strengthening) since it affects every task worker.

<!-- user answers here -->

---

### Should gtd depend on setup-matt-pocock-skills?

**Recommendation:** No hard dependency. gtd should work without any setup. But if `docs/agents/issue-tracker.md` exists (Matt's convention), gtd can read it for issue-based workflow (#5).

**Trade-off:** Matt's setup creates valuable config (issue tracker, triage labels, domain docs). Without it, issue-based workflow needs its own config. Could duplicate effort.

<!-- user answers here -->
