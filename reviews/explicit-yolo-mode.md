# Explicit CLI YOLO mode

## Design and actual paths

Existing auto is deliberately limited: PermissionManager prompts on risky Bash,
and both piped and interactive Bash executors separately block classified
commands. Registry factory expands workspace paths automatically only in auto.
There is no existing full-approval-bypass mode.

Add explicit --yolo and /mode yolo. PermissionManager allows every tool invocation
in this mode, regardless of saved allow/deny or Bash risk. Supply a live host-only
isYolo callback to Bash factories so both ordinary and interactive executors
skip their command risk veto, including child registries. Never accept authority
from model tool input. Returning to default/auto/plan immediately restores their
existing policy and Bash checks; no settings or historical sessions are rewritten.

YOLO is never selected by non-TTY fallback, resume alone, or the ordinary mode
cycle. Enter it explicitly for each process; --yolo --resume is supported. Footer,
/mode, slash help and CLI help expose the name and its full-approval semantics.
Existing auto/default/plan behavior is unchanged. Dry-run, cancellation, input
validation, skill tool availability, explicitly configured pre-execution hooks,
OS authentication and actual command failures keep their existing semantics.
Path expansion uses the existing auto path, so the host does not interrupt with
a separate workspace approval while YOLO is active.

## Adversarial review

- An input field named yolo/isYolo must not change approval or executor authority.
- Do not merely suppress the prompt: verify actual Bash execution on a disposable
  local repository with a forced tag update and a synthetic blocked-pattern probe.
- Preserve the default direct bashTool export, so callers without an explicit
  authorized host do not accidentally acquire a bypass.
- Use the current manager for existing and subsequently created registries;
  assert switching modes off revokes the bypass for both execution paths.
- No global install relink, user configuration change or live-session takeover.
  Scope copies preserve other dirty edits; real TTY fixtures are isolated and
  all owned processes are reclaimed.

## Validation

Four new production-entry regressions failed before implementation and passed
after it. The full chat integration file passed (68 tests), with only four
slash-command-count expectations needing the added explicit menu entry. Final
permission/Bash/input regressions: 1469 passed, 57 existing skips; separate
registry-factory wiring suite: 23 passed. Release build and governance passed
without baseline changes.

Both built and installed CLI entries passed the two real TTY activation paths.
They executed a forced tag update against an isolated
local bare repository and checked the actual remote ref. The inert `echo mkfs`
probe verified the executor veto was bypassed as well as the permission UI.
Explicit YOLO resume stayed prompt-free, plain resume returned to default, and
returning to auto restored the risk prompt and denied execution on refusal.
Each case reclaimed all owned CLI processes. No real user settings were changed.
