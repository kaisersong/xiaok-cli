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

A skill is not done because the YAML parses. It is done when:

- its trigger is clear
- its scope is narrow enough to route
- it contains examples
- it defines success criteria
- it survives `validate_skill`

## Verifiability

If a skill cannot be checked with examples and success criteria, it is too vague
to trust. Every user-authored skill should give future agents a concrete way to
tell whether they are done.
