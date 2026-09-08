import { randomUUID } from 'node:crypto';
import type { Tool, ToolExecutionContext } from '../../src/types.js';
import type { CustomAgentDef } from '../../src/ai/agents/loader.js';
import { MULTI_AGENT_TOOL_NAMES } from '../../src/ai/tools/multi-agent.js';
import { getCanonicalToolId } from '../../src/ai/tools/tool-identity.js';
import { agentDisplayNames } from '../shared/subagent-presentation.js';
import type { DesktopAgentExecutionContext, DesktopAgentSessionSeed, DesktopMultiAgentService } from './desktop-multi-agent-service.js';

export interface DesktopMultiAgentToolOptions {
  service: DesktopMultiAgentService;
  context: DesktopAgentExecutionContext;
  agents: CustomAgentDef[];
  allowedControls?: readonly string[];
  createSeed(input: { agentDef: CustomAgentDef; forkContext: boolean }, context?: ToolExecutionContext): DesktopAgentSessionSeed;
}

/** No IPC-supplied group/caller/source and no legacy CLI executor or inbox. */
export function createDesktopMultiAgentTools(options: DesktopMultiAgentToolOptions): Tool[] {
  const identity = () => {
    options.context.signal.throwIfAborted();
    return { actor: options.context.actor, requestSource: 'agent' as const };
  };
  const operation = (context?: ToolExecutionContext) => {
    context?.signal?.throwIfAborted();
    return { ...identity(), operationId: `${options.context.turnId}:${context?.toolInvocationId ?? randomUUID()}` };
  };
  const text = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 16 * 1024) throw new Error('invalid message or 16KiB limit');
    return value;
  };
  const properties = { target: { type: 'string', minLength: 1 }, message: { type: 'string', minLength: 1 } };
  const decorate = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    const row = value as Record<string, unknown>;
    const target = typeof row.targetAgentId === 'string'
      ? options.service.presentation({ ...identity(), target: row.targetAgentId }) : undefined;
    return { ...row,
      ...(target ? { displayNames: agentDisplayNames(target.presentationOrdinal) } : {}),
      ...(typeof row.presentationOrdinal === 'number' ? { displayNames: agentDisplayNames(row.presentationOrdinal) } : {}),
      ...(Array.isArray(row.agents) ? { agents: row.agents.map(decorate) } : {}),
      ...(Array.isArray(row.items) ? { items: row.items.map(decorate) } : {}),
    };
  };
  const make = (name: string, description: string, schema: Record<string, unknown>, required: string[],
    invoke: (input: Record<string, unknown>, context?: ToolExecutionContext) => unknown | Promise<unknown>): Tool => ({
    permission: 'safe', definition: { name, description,
      inputSchema: { type: 'object', properties: schema, required, additionalProperties: false } },
    execute: async (input, context) => {
      identity(); context?.signal?.throwIfAborted();
      if (Object.keys(input).some(key => !Object.hasOwn(schema, key))) throw new Error('unexpected multi-agent control argument');
      return JSON.stringify(decorate(await invoke(input, context)));
    },
  });
  const tools = [
    make('spawn_agent', '启动独立 Desktop 子任务并立即返回 ID 和 displayNames 代号。面向用户的正文使用对应语言的代号；技术 ID 仅用于工具调用。只能分派有边界的工作；严禁越过父工具权限和工作区。子任务与主任务共享本轮模型，不支持模型覆盖。需要协作消息用 send_message，追加任务用 followup_task。', {
      task_name: { type: 'string', pattern: '^[a-z0-9_]{1,64}$' }, message: properties.message,
      agent: { type: 'string' }, description: { type: 'string', maxLength: 4096 },
      tools: { type: 'array', maxItems: 256, items: { type: 'string', maxLength: 256 } },
      model: { type: 'string' }, modelCapability: { type: 'string' },
      isolation: { type: 'string', enum: ['none', 'worktree'] }, fork_context: { type: 'boolean' },
    }, ['task_name', 'message'], (input, context) => {
      const request = operation(context); const message = text(input.message);
      const configured = typeof input.agent === 'string' ? options.agents.find(agent => agent.name === input.agent) : undefined;
      if (input.agent && !configured) throw new Error('unknown predefined agent');
      const agentDef: CustomAgentDef = configured ? structuredClone(configured) : {
        name: String(input.task_name), systemPrompt: typeof input.description === 'string' ? input.description : '',
        cleanup: 'keep', isolation: input.isolation === 'worktree' ? 'worktree' : undefined,
      };
      if (input.model !== undefined || input.modelCapability !== undefined || agentDef.model !== undefined || agentDef.modelCapability !== undefined) throw new Error('desktop_multi_agent_model_override_unsupported');
      const selected = Array.isArray(input.tools) ? (input.tools as string[]).map(getCanonicalToolId) : undefined;
      const configuredTools = agentDef.allowedTools?.map(getCanonicalToolId);
      if (selected !== undefined) agentDef.allowedTools = configuredTools === undefined
        ? selected : selected.filter(name => configuredTools.includes(name));
      else if (configuredTools !== undefined) agentDef.allowedTools = configuredTools;
      const sessionSeed = options.createSeed({ agentDef, forkContext: input.fork_context !== false }, context);
      return options.service.spawn({ ...request, taskName: String(input.task_name), message, sessionSeed });
    }),
    make('send_message', '只能向同组 Agent 或 main/parent 发送消息。严禁冒充用户或其他 Agent；消息不触发新执行，在下一模型边界确认进入上下文，不代表模型已理解。', properties, ['target', 'message'], (input, context) =>
      options.service.send({ ...operation(context), target: String(input.target), message: text(input.message) })),
    make('followup_task', '只能给严格后代追加任务；严禁控制自身、main、祖先或兄弟。忙碌时最多排队四轮，组内追加可在当前执行组继续；ACK queued_next_admission 不代表已运行，需按 operationId/expectedTurn 等待。用户已排队的下一轮是屏障，遇到 multi_agent_followup_user_barrier 不可反复重试。', properties, ['target', 'message'], (input, context) =>
      options.service.followup({ ...operation(context), target: String(input.target), message: text(input.message) })),
    make('wait_agent', '等待同组目标消息通知或实际执行结算。严禁把 stopping/cleanup_pending 当作结束。消息由模型边界消费；本工具不消费正文。等待追加结果时使用 ACK 的 operationId/expectedTurn，operationId 只能对应单个目标；不能把旧轮完成当作新轮结果。非法轮次或用户下一轮屏障会报错，不可反复重试；用户下一轮须当前执行组结束后才可运行。', {
      targets: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1 } },
      timeout_ms: { type: 'number', minimum: 1 }, operation_id: { type: 'string' }, expected_turn: { type: 'integer', minimum: 1 },
    }, ['targets'], input => options.service.wait({ ...identity(), targets: input.targets as string[],
      timeoutMs: Math.max(1, Math.min(30_000, typeof input.timeout_ms === 'number' ? input.timeout_ms : 10_000)),
      operationId: input.operation_id as string | undefined, expectedTurn: input.expected_turn as number | undefined })),
    make('list_agents', '分页读取同组执行状态和物理清理状态。严禁根据 status=closed 推断资源已释放；只有 resourcesReleased=true 才表示完整释放。', {
      cursor: { type: 'string' },
    }, [], input => options.service.list({ ...identity(), cursor: input.cursor as string | undefined })),
    make('interrupt_agent', '只能中断严格后代的当前执行并取消此前排队续跑。严禁中断 main、自身、祖先、兄弟。接受取消不等于执行已退出。', { target: properties.target }, ['target'], (input, context) =>
      options.service.interrupt({ ...operation(context), target: String(input.target) })),
    make('close_agent', '只能关闭严格后代及其子树。严禁关闭 main、自身、祖先、兄弟。cleanup_pending 时严禁声称已释放资源；关闭后不能续跑。', { target: properties.target }, ['target'], (input, context) =>
      options.service.close({ ...operation(context), target: String(input.target) })),
  ];
  const allowed = new Set(options.allowedControls ?? MULTI_AGENT_TOOL_NAMES);
  return tools.filter(tool => allowed.has(tool.definition.name));
}
