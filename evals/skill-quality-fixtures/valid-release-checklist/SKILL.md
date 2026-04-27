---
name: release-checklist
description: Validate whether a single repository change is ready to ship
when-to-use: Use when a user asks whether one code change or branch is ready for release.
task-goals:
  - verify release readiness for one change
input-kinds:
  - branch diff
output-kinds:
  - release readiness summary
examples:
  - check whether this branch is ready to ship
---
# Goal

Run a single release-readiness pass for one code change.

## Workflow

1. Review the stated release candidate.
2. Check the required verification signals.
3. Summarize blockers and ready-to-ship confidence.

## Non-Goals

- Do not write release notes.
- Do not deploy anything.

## Success Criteria

- The result says whether the change is ready to ship.
- Missing verification is called out explicitly.
