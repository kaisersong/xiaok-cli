export async function executeSubAgent(input) {
    const tools = input.allowedTools?.join(', ') || 'default';
    const model = input.model ?? 'inherit';
    const maxIterations = input.maxIterations ?? 'inherit';
    return `subagent completed: ${input.prompt} | tools=${tools} | model=${model} | maxIterations=${maxIterations}`;
}
