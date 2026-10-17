# One /mode command sets the current permission mode

Current behavior: /mode only prints the current mode; the slash registry adds
four separate entries for default/auto/plan/yolo. Keep one visible command and
open a four-choice selector initialized to the live PermissionManager mode.
Confirming a choice uses the existing manager and status-bar update path. Escape,
Ctrl+C or EOF cancels; no implicit switch or persistence. Keep typed arguments
compatible without advertising them as separate commands.

Adversarial review: rendering must use the existing ReplRenderer footer overlay;
no plain stdout menu over the editor. Only a trusted local user selection can
activate yolo; descriptions retain its no-confirmation meaning. On cancellation
keep the old mode. Hand off stdin using the existing raw-mode/session ownership
helpers, remove listeners on every exit, and never auto-select in non-TTY input.
Preserve /models completion and Shift+Tab cycling. Cover a real CLI TTY selection
and real tool side effects, not only selection labels or a mocked selector.

A 12-row regression failed because generic overlays keep only their bottom
slice, hiding the selected default entry. Give ReplRenderer.renderInput an
optional overlay kind (default generic); mode choices reuse the existing question
windowing path. Clearing the selector resets the kind, preserving existing
model/slash/permission behavior. Normalize enhanced and batched keys through the
shared key parser; a focused batch regression covers two arrows plus Enter.

CI prerequisite: adding the existing memory suites exposed their Chinese/English
FTS assertion on hosts where npm ci --ignore-scripts left optional nodejieba
unbuilt. Preserve the assertion and rebuild that existing dependency alongside
the other native modules; include its segmentation test so the actual tokenizer
runs in all matrix jobs. No retrieval implementation or query expectation changes.

Validation: the single-entry metadata regression and the tiny-terminal selection
regression failed before their fixes. Final focused suite: 285 tests passed,
including 69 actual chat-runtime cases, all four current modes, cancel/EOF,
legacy typed arguments, /models routing, batched/enhanced keys and 12-row focus.
Release build and governance passed. Real CLI TTY passed the single slash entry,
arrow/numeric choices, 40x12 resize, cancellation preserving yolo, an actual yolo
file write, plan denial of a second write, and default/auto switches. All owned
CLI processes exited and the local SSE server closed.
