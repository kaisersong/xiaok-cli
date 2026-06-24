/**
 * Layer 5: Tool usage grammar — which tool for which job.
 * English.
 */
export function getUsingToolsSection(): string {
  // 结构化首读 recipe 可用 XIAOK_NO_STRUCTURAL_FIRST=1 关闭：
  // 既作为 A/B 的 baseline 臂，也作为出问题时的逃生阀。
  const structuralFirst = process.env.XIAOK_NO_STRUCTURAL_FIRST === '1'
    ? []
    : [
      '',
      '## Structural-first reading (save tokens before reading whole files)',
      'Before reading a large source file or scanning an unfamiliar directory in full, take one cheap structural pass to decide what to read. Reading entire files just to learn their shape is expensive. This is a judgment call: prefer it for large files (hundreds of lines), large or unknown directories, and architecture questions; skip it for tiny files or when one Grep already answers the question.',
      '  - File shape: `lsp documentSymbol` gives a symbol outline with line numbers and works even without a configured LSP server (it falls back to a syntactic approximation). Prefer it as the first read for a candidate file.',
      '  - As a portable alternative, use Grep to map declarations before opening the body:',
      '    - local shape: pattern `^\\s*(export\\s+)?(public\\s+|pub\\s+)?(class|interface|struct|enum|function|func|def|fn|impl|type)\\b`',
      '    - exported surface of a directory: pattern `^\\s*export\\b` with the relevant type filter',
      '    - focus one symbol: pattern `\\b(class|function|def|fn)\\s+<Name>\\b`',
      '  - Then Read only the smallest useful line range the outline points to, instead of the whole file.',
      '  - These outlines are syntactic approximations, not semantic truth. For "where is this defined / who references it / what type is this", use lsp goToDefinition/findReferences/hover with a configured server.',
    ];
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
    '- Use render_ui when a compact, read-only report UI would help the user scan metrics, tables, short lists, headings, dividers, and explanatory text. Its sections DSL uses a kind discriminator: heading/text/metric/table/list/divider. Text sections use content, not text. Do not use render_ui for forms, charts, buttons, links, scripts, arbitrary styles, or interactive actions. Keep data minimal: only include values that are displayed.',
    '- When handling substantial work, keep the active intent and ordered delegation steps accurate with the intent-delegation tools instead of free-form internal bookkeeping.',
    '- You can call multiple tools in a single response. If you intend to call multiple tools and there are no dependencies between them, make all independent tool calls in parallel. Maximize use of parallel tool calls where possible to increase efficiency. However, if some tool calls depend on previous calls to inform dependent values, do NOT call these tools in parallel and instead call them sequentially. For instance, if one operation must complete before another starts, run these operations sequentially instead.',
    ...structuralFirst,
  ].join('\n');
}
