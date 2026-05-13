# CLAUDE.md

## Terminal Frontend Interface Constraint

The terminal frontend is the **entire interface**. If you find yourself wanting to
directly manipulate ANSI codes, bypass scroll regions, or "just fix the cursor
position" without reading the design docs, you've reached for the wrong tool —
there is a frontend subsystem or design rule for what you need.

**Never:**
- Directly write ANSI escape sequences without consulting scroll-region design
- Manipulate cursor position without understanding `_cursorRow` vs `_cursorCol` tracking
- Bypass the footer / status bar state machine
- Change render order without reading the architecture doc
- Call scroll region methods without checking cursor tracking rules (Section 9.5)

**Always:**
- Consult design docs first (Section 9 of architecture doc is the scroll/cursor authority)
- Use the frontend state machine methods
- Follow the render pipeline ownership rules
- Update test matrix when changing interaction patterns
- Check memory for recent fixes before assuming design is current

## Frontend Change Gate

Before changing any terminal frontend code, walk through this gate:

**1. Which design doc governs this change?**
   - Identify the relevant doc: architecture / test matrix / change checklist
   - Read the governing section completely (not just skim)
   - If no section covers this, CREATE ONE before proceeding

**2. Which frontend subsystem does this touch?**
   - Map to subsystem: scroll region / footer / status bar / live activity / tool rails / overlays
   - Check the subsystem's state variables / render contract / cursor tracking rules
   - If subsystem rules are unclear, STOP and document the subsystem first

**3. What's the test coverage?**
   - Check test matrix for regression class
   - If missing, ADD regression test BEFORE implementing change
   - If tmux E2E needed, write it FIRST (all frontend bugs must be verified in real terminal)

**Gate passed → proceed to implementation**
**Gate failed → STOP and fix design/test first**

**Gate Exception: Design Outdated**

If you read the design doc and discover it conflicts with current implementation:
1. STOP the current change
2. Document the inconsistency: "Design says X, implementation does Y"
3. Check memory for recent fixes that may not be in design doc
4. Update design doc to match implementation + memory knowledge
5. Then proceed with your change

This exception is temporary until all subsystem design docs are fully synced.

## Frontend Design-First Rule

For any `xiaok chat` terminal frontend change, design is a required input, not an optional reference.

### You must read the frontend design docs before coding when:

- adding any new user-visible terminal interaction or frontend feature
- fixing any complex frontend bug, especially bugs involving more than one of:
  - content streaming
  - footer / input prompt
  - status bar
  - live activity (`Thinking` / `Working`)
  - tool activity rails (`Explored` / `Ran` / `Changed`)
  - intent hint / summary line
  - overlays, permission prompts, feedback prompts
  - compat / plain mode fallback
  - scroll / cursor / viewport behavior
- changing render order, spacing, indentation, color semantics, or layout ownership
- changing turn lifecycle, prompt-surface behavior, or frontend state transitions
- adding or changing frontend regressions, interactive runtime tests, or tmux E2E tests

### You must update the design docs in the same change when:

- a frontend feature introduces a new visible interaction pattern, layout rule, or state
- a bug fix changes the user-visible interaction contract
- a bug fix changes frontend state transitions, render ownership, fallback behavior, or scroll logic
- a new regression class is discovered and must become part of the permanent test strategy
- the implementation no longer matches the current class diagram, sequence diagrams, state diagrams, layout rules, or test matrix

### Required documents

Read and maintain these documents as the canonical frontend design set:

1. `docs/design/README.md`
2. `docs/design/2026-04-23-xiaok-terminal-frontend-architecture-design.md`
3. `docs/design/2026-04-23-xiaok-terminal-frontend-test-matrix.md`
4. `docs/design/2026-04-23-xiaok-terminal-frontend-change-checklist.md`

### How many design docs to update

Do not blindly edit all design docs every time. Update the smallest complete set
that keeps design and implementation aligned:

- **1 doc minimum** for any frontend-affecting change:
  - update the single most relevant existing design doc if the change is narrow
  - example: a pure regression-layer change may only need the test matrix
- **2 docs minimum** when a change affects both behavior and verification:
  - usually `architecture` + `test matrix`
  - or `test matrix` + `change checklist`
- **3 docs** when a change affects visible interaction rules or state ownership:
  - `architecture`
  - `test matrix`
  - `change checklist`
- **add a new design doc** when the change introduces a new frontend subsystem,
  a new reusable interaction pattern, or a bug class that cannot be explained
  cleanly by the current architecture doc
- **update `docs/design/README.md`** whenever:
  - a new design doc is added
  - the canonical reading order changes
  - the frontend design set gains or loses scope

### Operational standard

- Do not ship a frontend change as an implementation-only patch when it changes behavior that future work must reason about.
- If a real user bug required reading transcripts, reproducing terminal state, or adding interactive/tmux regressions, update the design docs and test matrix before considering the fix complete.
- If you cannot explain a frontend change against the design docs, stop and repair the design first.

### Frontend Etiquette

When modifying terminal frontend code, follow these collaboration rules:

**Design-first, always:**
- Never change render logic, ANSI codes, cursor behavior, scroll region management, or state transitions without reading the governing design doc section
- If instinct says "just fix this line", find the right design doc section instead
- Quote the design rule or state diagram node when implementing — don't paraphrase or improvise

**Quote the design, don't invent:**
- When implementing, cite the relevant design rule: "Per Section 9.5, cursor column must be reset after `writeAtContentCursor()`"
- If the design doc is silent on something, add to the doc FIRST, then implement
- Never assume behavior is "obvious" — if it's not in design doc, it's undocumented

**Be honest about uncertainty:**
- If a frontend behavior is undocumented, state it plainly: "_cursorCol reset timing is not explicitly documented in Section 9.5"
- Do not guess cursor semantics, scroll region contracts, or render order
- If implementation contradicts design, update design doc, don't silently diverge

**Update docs in the same change:**
- A frontend change that affects user-visible interaction MUST update the design docs in the same commit
- No deferred doc updates — "I'll update docs later" has proven to create accumulation of undocumented changes
- Include design doc update in the PR, not as a follow-up

**Check memory for recent fixes:**
- Before assuming design doc is current, check memory files for recent scroll-region fixes
- Memory captures bug fixes and rule refinements that may not be synced to design doc yet
- If memory says "fixed X", and design doc doesn't mention X, update design doc first

**Test in real terminal:**
- All frontend bugs must be verified in real terminal (tmux E2E or interactive test)
- Unit tests alone cannot verify ANSI rendering, cursor positioning, or scroll behavior
- `python3 tests/e2e/tmux-e2e.py` is mandatory for scroll region changes
