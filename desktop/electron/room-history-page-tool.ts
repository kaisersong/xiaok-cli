/**
 * getRoomMessagesPage — agent-only 语义 wrapper（design §6.2 RoomHistoryReadCapability）
 *
 * 设计依据：mydocs/xiaok-cli/design/2026-08-31-collaboration-room-evidence-first-execution-and-gate-design.md v8
 *   §6.2 —— "Agent 可调用的语义 wrapper 只有：
 *   getRoomMessagesPage({afterSequence?, beforeSequence?, limit})
 *   冻结分页常量：默认 50，最大 200；limit 非整数/越界直接拒绝，不静默放大。"
 *
 * 架构说明（已核实并记录）：xiaok-cli 的 ToolRegistry 是进程级共享单例，
 * InProcessTaskRuntimeHost 没有 per-task 临时工具注入机制，扩展核心
 * TaskExecutionScope union 类型是跨仓库架构变更，需要独立设计评审。本工具
 * 采用最小侵入方案：全局仅注册一次，execute 时用 ToolExecutionContext.taskId
 * （xiaok-cli 既有能力）查 room-history-capability-registry.ts 维护的绑定表。
 * 未注册的 taskId（所有普通非 Room 任务）查表返回 undefined，工具据此拒绝
 * 执行——模型和 tool input 完全看不到 roomId/claimToken 本身（工具 schema
 * 只暴露 afterSequence/beforeSequence/limit），身份字段只存在于闭包查表，
 * 不进入 LLM 上下文，符合设计文档"模型和 tool input 都看不到也不能改这些
 * 身份字段"的要求。
 *
 * 本模块延迟绑定 broker client（setRoomHistoryBrokerClient），因为
 * collaborationRoomBrokerClient 在 main.ts 中创建的时机晚于
 * createDesktopServices/registry 初始化。
 */
import type { Tool } from '../../src/types.js';
import { getRoomHistoryCapability } from './room-history-capability-registry.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface RoomHistoryPageBrokerClient {
  listRoomMessagesPage(input: {
    roomId: string;
    claimToken: string;
    afterSequence?: number;
    beforeSequence?: number;
    limit?: number;
  }): Promise<Record<string, unknown>>;
}

let boundBrokerClient: RoomHistoryPageBrokerClient | null = null;

export function setRoomHistoryBrokerClient(client: RoomHistoryPageBrokerClient | null): void {
  boundBrokerClient = client;
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(value, MAX_PAGE_SIZE);
}

export function createGetRoomMessagesPageTool(): Tool {
  return {
    permission: 'safe',
    definition: {
      name: 'getRoomMessagesPage',
      description: '在协作空间任务执行期间按需补取更早的历史消息，用于确认当前上下文窗口不完整时的具体历史内容。仅在协作空间任务中可用；对普通任务调用无效果。',
      inputSchema: {
        type: 'object',
        properties: {
          afterSequence: { type: 'number', description: '只返回该 sequence 之后的消息（可选）' },
          beforeSequence: { type: 'number', description: '只返回该 sequence 之前的消息（可选）' },
          limit: { type: 'number', description: '返回的最大消息数，默认 50，最大 200' },
        },
      },
    },
    async execute(input, context) {
      const taskId = context?.taskId;
      if (!taskId) return 'Error: 无法确定当前任务身份';

      const capability = getRoomHistoryCapability(taskId);
      if (!capability) {
        return 'Error: 当前任务不是协作空间任务，无法补取历史消息';
      }
      if (!boundBrokerClient) {
        return 'Error: 协作空间历史服务当前不可用';
      }

      const limit = clampLimit(input.limit);
      const afterSequence = typeof input.afterSequence === 'number' ? input.afterSequence : undefined;
      const beforeSequence = typeof input.beforeSequence === 'number' ? input.beforeSequence : undefined;

      try {
        const result = await boundBrokerClient.listRoomMessagesPage({
          roomId: capability.roomId,
          claimToken: capability.claimToken,
          ...(afterSequence !== undefined ? { afterSequence } : {}),
          ...(beforeSequence !== undefined ? { beforeSequence } : {}),
          limit,
        });
        if (result?.ok === false) {
          return `Error: 补取历史失败 (${String(result.error || 'unknown_error')})`;
        }
        return JSON.stringify(result);
      } catch (err) {
        return `Error: 补取历史时发生异常 (${err instanceof Error ? err.message : String(err)})`;
      }
    },
  };
}
