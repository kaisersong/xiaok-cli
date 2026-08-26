import type { Tool, ToolExecutionContext } from '../../types.js';

export interface GoalToolHost {
  getGoal(context?: ToolExecutionContext): Promise<unknown> | unknown;
  requestComplete(summary: string, context?: ToolExecutionContext): Promise<{ accepted: boolean; reason?: string }>;
  requestBlocked(input: { reason: string; fingerprint: string }, context?: ToolExecutionContext): Promise<{ accepted: boolean; reason?: string }>;
}

export function createGoalTools(host: GoalToolHost): Tool[] {
  return [
    {
      permission: 'safe',
      definition: {
        name: 'goal_get',
        description: '读取当前 Goal 状态、完成条件和剩余预算。此工具只读。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      async execute(_input, context) {
        return JSON.stringify(await host.getGoal(context));
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'goal_request_complete',
        description: '申请完成当前 Goal。只能在当前 Goal Turn 已产生满足全部完成条件的真实证据后调用；严禁用总结文本代替文件、命令或项目证据。此工具只提交申请，最终状态由 host evaluator 决定。',
        inputSchema: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
          additionalProperties: false,
        },
      },
      async execute(input, context) {
        const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
        if (!summary) return 'Error: summary is required';
        const result = await host.requestComplete(summary, context);
        return result.accepted ? 'Goal completion claim accepted for host evaluation' : `Error: ${result.reason ?? 'claim rejected'}`;
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'goal_request_blocked',
        description: '申请将当前 Goal 标记为 blocked。只能在同一阻碍连续三个 admitted Goal Turn 后调用；严禁 pause、cancel、replace 或修改用户预算。host 会复核 fingerprint 和连续轮次。',
        inputSchema: {
          type: 'object',
          properties: { reason: { type: 'string' }, fingerprint: { type: 'string' } },
          required: ['reason', 'fingerprint'],
          additionalProperties: false,
        },
      },
      async execute(input, context) {
        const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
        const fingerprint = typeof input.fingerprint === 'string' ? input.fingerprint.trim() : '';
        if (!reason || !fingerprint) return 'Error: reason and fingerprint are required';
        const result = await host.requestBlocked({ reason, fingerprint }, context);
        return result.accepted ? 'Goal blocked claim accepted for host audit' : `Error: ${result.reason ?? 'claim rejected'}`;
      },
    },
  ];
}
