/**
 * Layer 5: Tool usage grammar — which tool for which job.
 * English.
 */
export function getUsingToolsSection() {
    return [
        '# Using your tools',
        'Do NOT use Bash to run commands when a dedicated tool is provided:',
        '- Read files: use read tool, NOT cat/head/tail/sed',
        '- Edit files: use edit tool, NOT sed/awk',
        '- Create files: use write tool, NOT echo redirection',
        '- Search files: use glob tool, NOT find or ls',
        '- Search content: use grep tool, NOT grep/rg bash commands',
        '- Reserve Bash exclusively for system commands and terminal operations that require shell execution.',
        '',
        'You can call multiple tools in a single response. If you intend to call multiple tools and there are no dependencies between them, make all independent tool calls in parallel.',
        'Break down and manage your work with task tools when dealing with complex multi-step tasks.',
    ].join('\n');
}
