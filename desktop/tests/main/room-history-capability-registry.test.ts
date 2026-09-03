/**
 * RoomHistoryCapabilityRegistry — per-task 绑定 claim token 的能力注册表
 * （design §6.2 RoomHistoryReadCapability 的 Desktop 侧接线）
 *
 * 现状核实（2026-09-02）：Desktop 侧 collaboration-room-broker-client.ts
 * 的 listRoomMessagesPage 方法此前只在测试文件里被调用，从未被
 * collaboration-room-wake-dispatcher.ts 或 desktop-services.ts 真正消费——
 * agent runtime 完全没有一个可调用的、绑定当次 wake 身份的历史补取工具。
 *
 * 深层原因（已核实）：runCollaborationRoomAgentTask 是"一次性 prompt +
 * 单次调用"，不是持续 agent session；InProcessTaskRuntimeHost 的
 * ToolRegistry 是进程级共享单例（所有任务共用同一批已注册工具），没有
 * per-task 临时工具注入机制；扩展 xiaok-cli 核心的 TaskExecutionScope union
 * 类型是跨仓库架构变更，需要独立设计评审，不能在本轮草率扩展。
 *
 * 本模块采用最小侵入方案：不新增工具注册机制，不扩展 TaskExecutionScope。
 * ToolExecutionContext 本身已经携带 taskId（xiaok-cli 既有能力）——
 * 用一个 taskId → {roomId, claimToken} 的绑定表，配合一个全局仅注册一次的
 * getRoomMessagesPage 工具（在 execute 时用 context.taskId 查表），实现
 * "只在当前 Room 任务执行期间可用，绑定当次 wake 身份"的效果，不需要改动
 * xiaok-cli 核心类型系统。
 *
 * Run: node --loader ts-node/esm 不适用；本文件是纯 TS 单测，由 vitest 驱动。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerRoomHistoryCapability,
  getRoomHistoryCapability,
  releaseRoomHistoryCapability,
} from '../../electron/room-history-capability-registry';

describe('RoomHistoryCapabilityRegistry', () => {
  afterEach(() => {
    releaseRoomHistoryCapability('task-1');
    releaseRoomHistoryCapability('task-2');
  });

  it('registers and retrieves a capability bound to a taskId', () => {
    registerRoomHistoryCapability('task-1', { roomId: 'room-1', claimToken: 'token-1' });
    const capability = getRoomHistoryCapability('task-1');
    expect(capability).toEqual({ roomId: 'room-1', claimToken: 'token-1' });
  });

  it('returns undefined for a task with no registered capability (ordinary non-Room tasks)', () => {
    expect(getRoomHistoryCapability('task-unregistered')).toBeUndefined();
  });

  it('capabilities for different tasks do not leak into each other', () => {
    registerRoomHistoryCapability('task-1', { roomId: 'room-1', claimToken: 'token-1' });
    registerRoomHistoryCapability('task-2', { roomId: 'room-2', claimToken: 'token-2' });
    expect(getRoomHistoryCapability('task-1')?.roomId).toBe('room-1');
    expect(getRoomHistoryCapability('task-2')?.roomId).toBe('room-2');
  });

  it('releaseRoomHistoryCapability removes the binding so it cannot be reused after task completion', () => {
    registerRoomHistoryCapability('task-1', { roomId: 'room-1', claimToken: 'token-1' });
    releaseRoomHistoryCapability('task-1');
    expect(getRoomHistoryCapability('task-1')).toBeUndefined();
  });

  it('registering a new capability for the same taskId overwrites the previous one (no stale accumulation)', () => {
    registerRoomHistoryCapability('task-1', { roomId: 'room-1', claimToken: 'token-old' });
    registerRoomHistoryCapability('task-1', { roomId: 'room-1', claimToken: 'token-new' });
    expect(getRoomHistoryCapability('task-1')?.claimToken).toBe('token-new');
  });
});
