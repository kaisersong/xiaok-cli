export interface LoopLLMPort {
  complete(input: {
    model: 'fast';
    systemPrompt: string;
    userMessage: string;
    maxTokens: number;
    temperature: number;
  }): Promise<{ text: string }>;
}

export const EXTRACTION_SYSTEM_PROMPT = `你是一个 Loop 运行分析助手。根据给定的失败上下文，提取一条简短、可操作的改进规则。

规则要求：
- 一句话，≤50 个中文字符
- 必须是给执行 agent 的可操作指令（"做什么"或"不做什么"）
- 不要描述问题本身，只给解决方案
- 如果无法从上下文中提取有意义的规则，回复 "NONE"

示例输入：failureKind=missing_file_artifact, message="文件不存在"
示例输出：确保使用 Write 工具将完整内容写入目标文件路径，不要仅在对话中输出。`;

export interface ExtractionInput {
  loopTitle: string;
  loopPrompt: string;
  failureKind: string;
  failureMessage: string;
  lastAgentOutput: string;
}

export async function extractViaLLM(
  port: LoopLLMPort,
  input: ExtractionInput
): Promise<string | null> {
  const response = await port.complete({
    model: 'fast',
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userMessage: JSON.stringify(input),
    maxTokens: 100,
    temperature: 0,
  });
  const text = response.text.trim();
  if (!text || text === 'NONE' || text === '"NONE"') return null;
  return text;
}

const RULE_FALLBACK_MAP: Record<string, Record<string, string>> = {
  missing_file_artifact: {
    missing_file: '使用 Write 工具将内容写入目标路径，不要仅在对话中输出。',
    empty_file: '确保输出文件非空，至少包含标题和正文内容。',
  },
  evidence_missing: {
    missing_file: '使用 Write 工具将内容写入目标路径，不要仅在对话中输出。',
  },
};

export function extractViaRule(
  failureKind: string | undefined,
  failureReason: string | undefined,
  _metadata?: Record<string, unknown>
): string | null {
  if (!failureKind) return null;
  const kindRules = RULE_FALLBACK_MAP[failureKind];
  if (!kindRules) return null;
  if (!failureReason) return null;
  return kindRules[failureReason] ?? null;
}
