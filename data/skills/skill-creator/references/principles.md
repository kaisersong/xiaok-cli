# Skill Creator Principles

Use this reference when the user needs the longer explanation behind the skill
authoring rules.

## Single Goal

A skill should own one primary job. Signs that the user actually wants multiple
skills:

- multiple deliverables
- multiple unrelated trigger phrases
- multiple success criteria
- a request that mixes authoring, review, reporting, and execution

When that happens, recommend a split first.

## Progressive Disclosure

`SKILL.md` should stay focused on:

- what the skill is for
- when it should trigger
- what steps it follows
- what counts as done

Move bulky detail into:

- `references/` for docs and domain detail
- `scripts/` for deterministic helpers
- `assets/` for templates and output resources

## Validation

A non-strict skill is valid when its frontmatter parses, its required identity
fields are present, and any explicitly declared resources are coherent.
The following qualities are recommended and should be reported as warnings when
missing:

- its trigger is clear
- its scope is narrow enough to route
- it contains examples
- it defines success criteria

Run `validate_skill` before handoff. Fix errors; explain warnings as optional
improvements rather than treating them as execution blockers.

## Verifiability

Examples and success criteria can make a skill easier to route and review, but
they are not execution permissions. Use structured `success-checks` with
`strict: true` only when the user intentionally wants enforceable completion
checks.
