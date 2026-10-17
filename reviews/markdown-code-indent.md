# Code block left margin

## Evidence and design

Assistant prose uses a two-column hanging indent, but fenced code uses the empty
BODY_GUTTER. Raw and highlighted code therefore begin in column one. Align
nonempty code rows with the existing prose continuation prefix. Keep fence and
empty code rows blank, preserve the original code indentation after the display
gutter, and leave syntax colors unchanged. Apply the same display prefix to
rendered Mermaid rows and its source fallback.

## Adversarial review

- Do not restore decorative rails or add language labels to copied code.
- Do not insert hard wraps into code: long shell commands and string literals
  must retain their logical lines. Terminal-native wrapping remains unchanged.
- Raw stored assistant text and Ctrl+O details keep the original Markdown.
- The uniform two-space display gutter must be the only difference after ANSI
  removal. Preserve leading whitespace, quotes, pipes, literal rails and blanks.
- Exercise color/no-color themes, chunked streaming, partial flush, and history
  replay, which share the same MarkdownRenderer production path.
- Check actual terminal columns, draft/footer retention, and copied ordinary
  shell command execution in an isolated real TTY.

## Local verification

Four new renderer cases failed before the fix. After the change, 264 renderer,
table, history-formatting, scroll-region and actual chat-entry regressions
passed, plus four text-metric checks (268 distinct checks). Release build and
governance/changed architecture checks passed without baseline changes.

The isolated build and installed CLI both passed the real TTY regression:
character-chunk streaming and resume place code at the prose continuation
column, nested source indentation survives, the copied ordinary shell command
executes successfully, and draft input remains visible. Stored/model-facing
assistant Markdown remains unchanged. All owned CLI processes exited (zero
remaining). The display gutter is presentation whitespace; the original code
remains available in the detailed transcript.

A focused Markdown layout CI matrix covers macOS/Windows/Linux and Node 22.14/24,
with real TTY streaming/resume/copy verification on Linux. This does not remove
or weaken the separate existing Terminal UI workflow.
