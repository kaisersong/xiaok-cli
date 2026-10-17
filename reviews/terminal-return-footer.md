# Terminal return and footer geometry

Actual Ghostty 1.3.1 screenshots reproduce a detached gray stair-step after a
width/height change, with the editable draft still at the bottom. Pure app focus
return did not reproduce it in the initial native window probe. Existing reflow
tests covered submitted-input backgrounds; they did not certify native Ghostty
or the inactive-window geometry path.

On height shrink the terminal scrolls the viewport upward. updateSize currently
shifts activity clearing only when activity exists, does not shift content row
anchors, and clears the old absolute footer rows even when beyond the new screen.
Correct geometry bookkeeping and clear only old/current chrome in the new bounds.
Retain the existing input, selection/cursor, overlay owner and busy state. Do not
clear scrollback, replay model/tool calls, enter alternate screen, or remove the
footer background merely to hide the symptom.

Adversarial review: idle and busy shrink/grow must behave the same; shifted
anchors must not erase occupied transcript rows; new width must drive wrapping;
menus/permission overlays remain owned by their active renderer. Validate native
screens, real TTY history retention and editable draft plus next submission.

Refinement from real TTY evidence: height shrink first clips rows below the
physical editor cursor and only then scrolls that cursor into bounds. Using the
entire height delta erased the last response lines. Track the actual terminal
cursor separately from the transcript cursor, project old chrome and transcript
anchors by the physical shift, and account for history pulled back on growth.
Clear projected activity rows only, never both projected and old absolute rows.
The TTY harness now performs an independent physical viewport resize before the
production updateSize call; existing content-preservation assertions stay intact.

Regression evidence: the new idle/busy and overlay cases failed before repair;
a separate response-tail case failed with the naive full-height shift. Final
release/type build, 351 related tests (including 68 actual chat-runtime cases),
governance and incremental architecture checks passed. The isolated real CLI TTY
passed six width/height changes, singular gray footer, full transcript retention,
draft edits and exact persisted/provider input on the following turn. All owned
CLI processes exited and local SSE servers closed.

Native evidence: Ghostty 1.3.1 reproduced the original detached staircase (two
gray bands); an earlier corrected candidate showed one contiguous footer after
five resizes and accepted the next input. Final native acceptance is reproducible
with tests/e2e/ghostty-footer-return.py and its pixel-band helper. It requires an
unlocked Mac; final rerun was interrupted by macOS screen lock, which is reported
separately from the passing TTY tests. Pure focus return alone did not reproduce
the original defect. Screenshots and machine/session data remain private.

CI mechanism: Terminal UI runs the new unit regressions on Linux/macOS/Windows
at minimum/current Node versions and the isolated TTY regression on Linux,
retaining synthetic failure evidence. Native screenshots are a local manual
acceptance because hosted runners do not provide the user's Ghostty desktop.

Installed-entry verification: the global CLI entry passed the same six geometry
cases, plus both allow/deny Thinking-to-permission handoffs with resize, editable
multiline draft and exact next queued input. Owned CLI processes remaining: zero.
The native harness now refuses to create a window while macOS is locked; cleanup
uses the owned Ghostty window object, as required by its scripting dictionary.
Previously created probe windows were closed by their recorded IDs only.

Initial CI matrix: five jobs passed; Windows Node 22.14 passed all five new
rendering regressions but failed the existing repeated slash-exit/resume startup
wait (zero attached data listeners), followed by a late stdin shutdown. The
fixture restored its environment while startup was still pending. Give that
attachment wait the same 3s base budget as the existing input-ready check (15s
on Windows), without changing assertions or production exit behavior. Both
repeated exit modes and governance passed locally after the test-only change.
