/**
 * Layer 5: Tool usage grammar — which tool for which job.
 * English.
 */
export function getUsingToolsSection(): string {
  return [
    '# Using your tools',
    '',
    'Do NOT use Bash to run commands when a relevant dedicated tool is provided. Using dedicated tools allows the user to better understand and review your work. This is CRITICAL to assisting the user:',
    '  - To read files use Read instead of cat, head, tail, or sed',
    '  - To edit files use Edit instead of sed or awk',
    '  - To create files use Write instead of cat with heredoc or echo redirection',
    '  - To search for files use Glob instead of find or ls',
    '  - To search the content of files, use Grep instead of grep or rg',
    '  - Reserve using Bash exclusively for system commands and terminal operations that require shell execution. If you are unsure and there is a relevant dedicated tool, default to using the dedicated tool and only fallback on using Bash if it is absolutely necessary.',
    '- When handling substantial work, keep the active intent and ordered delegation steps accurate with the intent-delegation tools instead of free-form internal bookkeeping.',
    '- You can call multiple tools in a single response. If you intend to call multiple tools and there are no dependencies between them, make all independent tool calls in parallel. Maximize use of parallel tool calls where possible to increase efficiency. However, if some tool calls depend on previous calls to inform dependent values, do NOT call these tools in parallel and instead call them sequentially. For instance, if one operation must complete before another starts, run these operations sequentially instead.',
  ].join('\n');
}
