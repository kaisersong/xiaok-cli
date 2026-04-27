# CLAUDE.md

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
