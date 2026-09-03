/**
 * RoomHistoryCapabilityRegistry — per-task 绑定 claim token 的能力注册表
 * （design §6.2 RoomHistoryReadCapability 的 Desktop 侧接线）
 *
 * 设计依据：mydocs/xiaok-cli/design/2026-08-31-collaboration-room-evidence-first-execution-and-gate-design.md v8
 *   §6.2 —— "dispatcher 在 wake claim 成功后创建一次性 RoomHistoryReadCapability，
 *   用闭包绑定 roomId/roomMessageId/logicalAgentId/claimToken；模型和 tool
 *   input 都看不到也不能改这些身份字段。"
 *
 * 架构决定（已核实并记录，避免误判为遗漏）：不扩展 xiaok-cli 核心的
 * TaskExecutionScope union 类型，不新增 per-task 工具注入机制（那需要跨
 * 仓库改动 ToolRegistry/InProcessTaskRuntimeHost，属于需要独立设计评审的
 * 架构变更）。改用 ToolExecutionContext 已经携带的 taskId（xiaok-cli 既有
 * 能力，见 src/types.ts:ToolExecutionContext.taskId）：本模块只维护一个
 * taskId → capability 的绑定表，供全局仅注册一次的 getRoomMessagesPage 工具
 * 在 execute 时查表。模型和 tool input 完全看不到 roomId/claimToken 本身
 * （工具签名只暴露 afterSequence/beforeSequence/limit），身份字段始于闭包
 * 查表、终于本模块，不经过 LLM 上下文。
 *
 * 生命周期：collaboration-room-wake-dispatcher.ts 在 claimWake 成功后、
 * InProcessTaskRuntimeHost.createTask 之前调用 registerRoomHistoryCapability；
 * 任务结束（settled 或异常）后调用 releaseRoomHistoryCapability。未注册的
 * taskId（所有普通非 Room 任务）查表返回 undefined，工具据此拒绝执行。
 */

export interface RoomHistoryCapability {
  roomId: string;
  claimToken: string;
}

const capabilitiesByTaskId = new Map<string, RoomHistoryCapability>();

export function registerRoomHistoryCapability(taskId: string, capability: RoomHistoryCapability): void {
  capabilitiesByTaskId.set(taskId, capability);
}

export function getRoomHistoryCapability(taskId: string): RoomHistoryCapability | undefined {
  return capabilitiesByTaskId.get(taskId);
}

export function releaseRoomHistoryCapability(taskId: string): void {
  capabilitiesByTaskId.delete(taskId);
}
