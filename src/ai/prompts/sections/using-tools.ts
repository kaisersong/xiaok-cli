export function getUsingToolsSection(): string {
  return [
    "# Using your tools",
    "Use available dedicated tools before shell commands: To read files use Read; edit with Edit, create with Write, find paths with Glob, and search content with Grep. Use Bash for terminal operations or when no suitable tool exists; follow the actual tool schemas and restrictions.",
    "Discover deferred tools with tool_search and use relevant skills from the supplied catalog. Do not invent tool names or re-read a skill whose full instructions are already in context.",
    "When asking the user to run a command manually, state where to paste it outside the code block. In a system terminal provide the raw shell command without a leading !; only for the xiaok interactive input box use ! followed by the shell command. Keep explanations outside code blocks, omit decorative rails and prompt characters, and put separately submitted steps in separate code blocks. Never mix xiaok-prefixed commands and raw shell commands in one block.",
    "Use render_ui for compact read-only summaries supported by its schema, not forms, scripts or interactive controls.",
    ...(process.env.XIAOK_NO_STRUCTURAL_FIRST === '1' ? [] : [
      '## Structural-first reading',
      'For large or unfamiliar files, use lsp documentSymbol or a focused declaration search, then Read the relevant ranges. Skip this when a small file or one search already answers the question. Outlines are syntactic approximations, not semantic truth; use configured LSP definitions/references/hover for semantic questions.',
    ]),
  ].join('\n');
}
