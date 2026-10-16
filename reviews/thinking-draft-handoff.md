# Thinking draft input handoff

## Evidence and design

Busy capture already preserves drafts across streaming boundaries. The missing
boundary is an interactive permission prompt: both busy capture and the modal
listen to stdin, then the modal closes by disabling raw mode and pausing stdin.
The still-active busy capture is never reattached, so later keystrokes wait
until the next ordinary read. Approval digits can also enter the busy draft.

Use the existing shared `withPausedLiveActivity` boundary for interactive
prompts: snapshot whether busy capture owns input, pause that capture before
calling the prompt, and resume it in finally only if it was active on entry.
Resume the same handle to retain draft/cursor/queued text. Permission and
sandbox expansion share this boundary; feedback uses it too. External PTY
already pauses capture before entering, so it retains its own resume owner.

## Adversarial review

- Do not restart capture or clear the draft/queue on modal transitions.
- Already-paused, stopped, or replaced captures must not be reactivated by an
  inner prompt; only the scope that paused an active handle may resume it.
- Both allow and deny must restore typing, including exceptions/cancellation.
- Approval keys must only reach the modal, never the queued user input.
- AskUser already has its own stop/start ownership path; preserve that behavior.
- Keep activity placement and stream-end draft preservation unchanged.
- Permission cleanup must use the existing internal handoff helper, matching
  InputReader/AskUser. This preserves the Windows session raw-mode lease and
  avoids leaving a pending cooked read across rapid prompt-to-busy transitions;
  external PTYs still explicitly receive cooked input.
- Verify real production chat handlers and real TTY stdin flow; the simulated
  TTY harness does not implement the OS pause/raw-mode behavior.

## Verification plan

Red tests exercise a retained draft before approval, exclusive modal input,
restored editable draft while the model still waits, then normal completion.
Real CLI TTY uses a gated local SSE provider, so the response cannot finish
before the draft is asserted visible. Cover pre-tool Thinking, allow/deny,
reasoning deltas, resize, queue editing, and the next turn with exact model input.

## Local results

- Old production chat failed both allow/deny draft regressions; the real CLI
  TTY reproduced a persistent Thinking timer with an unchanged placeholder.
- The main change passed 257 related regressions, including 68 actual chat
  entry cases. Final raw-mode handoff tests passed 74 focused checks.
- A new Windows lease regression failed before permission cleanup used the
  existing internal handoff helper. Both simulated Windows and macOS pass.
- Release build, governance and changed architecture checks passed without
  modifying baselines.
- The gated local provider kept the model unfinished while checking editable
  Chinese drafts, backspace, resize in both directions, multiline input, queue
  submission and the exact next user input. Allow and deny both passed on the
  isolated build and the installed CLI. All owned CLI processes exited (zero
  remaining), and the normal exit persisted released ownership.
- Installation applied scoped hunks to chat source/dist and preserved unrelated
  startup changes, including the local chat test variant. Other dirty files
  were checked byte-for-byte unchanged. Existing user processes were untouched.
- Terminal UI CI now runs busy-input and runtime-state regressions across the
  three OSes and minimum/current Node, plus the gated real TTY on Linux.
