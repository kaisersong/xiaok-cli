# Resume history visibility

## Design and evidence

Compaction writes a synthetic user message containing the summary; the durable
compaction record stores the same text. CLI resume currently renders every user
text and every tool event as conversation output. This exposes internal context
as a submitted request and floods the screen with raw tool excerpts.

Project only the replay view: omit the first message only when it is a single
user text block exactly matching the latest nonempty compaction summary with a
positive replacement count. Keep runtime messages, adapter inputs, and persisted
history intact. Never infer provenance from a heading such as Context Summary.
Default replay shows conversation text and images; tool events remain in the
transcript buffer for Ctrl+O, rather than being printed again at startup.

## Adversarial review

- A user can submit a summary-looking heading: preserve it without a matching
  latest compaction record, and preserve identical text at later positions.
- Missing, stale, empty, or malformed provenance must fail visible.
- A text+image message must not be discarded even if its text matches a summary.
- Filtering must precede transcript-buffer insertion for the internal summary,
  but tools must still be recorded before their normal replay is suppressed.
- No durable migration, schema change, provider role change, or live tool
  rendering change is necessary. Retained images must continue to replay.

## Verification

Regression tests cover these boundaries. A local fake OpenAI API and real CLI
TTY verify default replay, Ctrl+O details, model input, normal exit, and repeated
resume without rewriting retained messages or compaction records.

Local result: 114 focused tests passed; all 66 interactive chat regressions
passed in the combined run. Build, governance and architecture checks passed.
The real TTY test passed for both the isolated build and the installed CLI,
including repeated resume, Ctrl+O, retained image display, and model request
content. Both runs reclaimed all owned CLI processes (zero remaining).
