# Background memory diagnostics must not overwrite the terminal editor

Observed production path: LayeredMemoryStore.startAutoCompact catches errors
and calls console.error while the real cursor is in the input footer. Three
timer failures therefore paint three lines over the editor/status. The chat
stderr router records bytes but does not route arbitrary diagnostics through
the content cursor. Changing this call to a normal warn logger still writes
stderr by default and does not fix the symptom.

Use the existing logger's file-only sink for the layered store's background
diagnostics, including embedding failure callbacks. Retain recognized internal
compaction codes; map unknown provider errors to a stable generic code rather
than persist arbitrary response bodies. Keep the actual rejection, incomplete
output checks, memory transactions, timer retries and original records intact.
No global stdout/stderr interception, UI callback, new toast, or redraw timer.
Other modules' initialization diagnostics are outside this timer-failure repair.

Adversarial review: error/debug logging must stay file-only even under XIAOK_LOG;
three consecutive failures must remain observable in the file and must not
change a draft, footer rows or physical cursor. Unknown multiline errors must
not escape to the terminal or log a provider body. The real CLI/provider TTY
fixture must produce finish_reason=length through the actual memory timer,
then prove editing and exact next input; do not fake the tested logger/timer.

Regression evidence: three unit cases failed before repair. With stderr sharing
the real TTY (the general harness normally discards it), three provider
finish_reason=length failures reproduced the editor overwrite. The fixture uses
current schema-v2 memory settings and a synthetic pending historical L0 record.
After repair the timer still failed and persisted all three safe error codes,
but the draft row and physical cursor stayed unchanged; edits and the exact
next persisted/provider input passed. All owned CLI processes exited and the
local SSE service closed. Initial focused suite: 162 tests passed, release
build and governance passed. Final installed-entry verification follows the
scoped integration.
