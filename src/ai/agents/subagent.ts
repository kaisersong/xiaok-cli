export interface SubAgentInput {
  prompt: string;
  allowedTools?: string[];
  model?: string;
  maxIterations?: number;
}

export async function executeSubAgent(input: SubAgentInput): Promise<string> {
  const tools = input.allowedTools?.join(', ') || 'default';
  const model = input.model ?? 'inherit';
  const maxIterations = input.maxIterations ?? 'inherit';

  return `subagent completed: ${input.prompt} | tools=${tools} | model=${model} | maxIterations=${maxIterations}`;
}
