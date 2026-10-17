# Remember approved write commands without granting interpreter wildcards

## Production paths and design

UI rememberedRules rejects all output destinations and unsupported heredoc
grammar. Policy matches rejects the same commands, and PermissionManager has a
third unconditional confirmation gate. All three must share the new decision.

Keep existing wildcard approval semantics unchanged. Add an explicit exact
command approval for ordinary literal write commands and a single quoted
interpreter-stdin heredoc. Bind it to the full original command and canonical
effective working directory; store only a SHA-256 fingerprint in the existing
user-owned project/global settings. UI describes the actual scope, not hashes.
Editing a script, target, suffix, workdir, or cwd requires a new approval.

Eligibility retains known block/warn/mandatory destructive rules and inspection
budgets. Shell syntax outside a quoted heredoc must remain fully parseable and
literal. Literal redirect destinations and cd/workdir transitions must stay in
the project or host temporary directories, with existing realpath resolution
for symlinks and missing parents. Sensitive file targets and unresolved paths
remain one-time. Hashing approved interpreter source is not static verification
of all Python side effects; the user approves that complete script, never an
arbitrary future interpreter payload.

## Adversarial review

- Exact rules are a new explicit grant; do not reinterpret old cd/python/bash
  wildcard rules, change user mode, or add rules to real settings automatically.
- Deny and plan mode win over the new grant. Known destructive commands, remote
  shell execution, sudo and dynamic shell expansion remain gated.
- Prefix/suffix edits, target changes, different cwd/workdir, symlink escapes,
  malformed/open heredocs, unquoted delimiters and multiple heredocs fail closed.
- A quoted heredoc is separated only to inspect the surrounding shell. Its full
  unmodified body participates in the fingerprint and risk checks.
- Session/project/global choices use the same rule, existing winning-terminal
  persistence and reload path; a project grant must not leak to another project.
- Manager/runtime matching must validate current eligibility again; the UI is
  not the authority. Sandbox, hooks and tool execution gates remain in place.
- Tests call actual UI choices, manager, registry and durable settings, plus real
  CLI TTY save/retry/exit/resume with exact input receipts. Other workspace WIP
  and active user sessions are preserved.

## Validation

- Before implementation, five exact persistence regressions failed against the
  existing UI/policy. The quoted fake-heredoc attack also failed before its
  scanner correction; runtime symlink changes remain in the regression suite.
- Final focused suite: 33 files, 1418 passed, 57 existing skips; release build,
  governance and architecture changed checks passed without baseline updates.
- Built entry and actual installed CLI entry both passed project/global ×
  project-log/quoted-Python real TTY cases: one approval, same-process repeat,
  exit/resume repeat, changed payload denied. Each case executed exactly three
  approved commands; owned CLI processes remaining: zero.
- Session resume CI now runs the full permission suite on three operating
  systems with minimum/current Node, and the four exact-grant TTY cases on Linux.
  This does not certify the separate Terminal UI Windows cleanup gate.
- Installed through scoped copies, preserving unrelated dirty source and tests;
  no real user settings or historical sessions were modified. Existing running
  CLI processes need normal exit/resume to load the new implementation.

The first expanded Windows CI run exposed two existing workspace-test callback
fixtures using POSIX-only slash comparisons. Their allowlist now uses the host
separator and denylist compares basename; the same positive/negative production
assertions remain mandatory on Windows. No test was excluded or skipped.

A final adversarial case concatenated text onto a quoted heredoc delimiter,
causing the shell to end the body before the inspection scanner. Its regression
failed before a delimiter-boundary check; concatenated delimiters now remain
once-only. This preserves the surrounding-shell path checks.
