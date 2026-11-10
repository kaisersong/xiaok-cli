import {
  assertOriginalBrokerAdmissionClient,
  readOriginalRoomSnapshot,
  claimOriginalRoomWake,
} from './collaboration-room-broker-client.js';
import {
  bindOriginalRoomProjectScopeGuardClient,
  readOptionalOriginalScopedRoomWakeAcceptance,
} from './room-project-scope-guard.js';
import { captureDispatchBusinessData } from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import { appendIntrinsic } from '../../src/runtime/verification/intrinsic-async-collection.js';
import type { RoomTurnCustody } from './original-room-turn-custody.js';
const roomSetPrototype = Object.setPrototypeOf,
  roomFreeze = Object.freeze,
  roomSort = Array.prototype.sort,
  roomSlice = Array.prototype.slice;
const originalDispatchers = new WeakMap<object, OriginalRoomWakeAcceptance>(),
  dispatcherGet = WeakMap.prototype.get,
  dispatcherSet = WeakMap.prototype.set,
  dispatcherApply = Reflect.apply;
const originalDispatcherClients = new WeakMap<object, object>(),
  originalDispatcherServices = new WeakMap<object, unknown>();
/** Exact original composition relation only: no HTTP, host registration,
 * callback verifier or Native permission is created by this binding. */
export function bindOriginalScopedRoomWakeDispatcher(
  dispatcher: unknown,
  service: unknown,
): void {
  const entry = dispatcherApply(dispatcherGet, originalDispatchers, [
    dispatcher,
  ]) as OriginalRoomWakeAcceptance | undefined;
  const client = dispatcherApply(dispatcherGet, originalDispatcherClients, [
    dispatcher,
  ]) as object | undefined;
  if (!entry || !client) throw Error('ROOM_TURN_ORIGINAL_DISPATCHER_REQUIRED');
  const prior = dispatcherApply(dispatcherGet, originalDispatcherServices, [
    dispatcher,
  ]);
  if (prior !== undefined && prior !== service)
    throw Error('ROOM_SCOPED_ORIGINAL_SERVICE_MISMATCH');
  if (!bindOriginalRoomProjectScopeGuardClient(client, service))
    assertOriginalBrokerAdmissionClient(client, service);
  dispatcherApply(dispatcherSet, originalDispatcherServices, [
    dispatcher,
    service,
  ]);
}
export interface OriginalRoomWakeCandidate {
  readonly envelope: CollaborationRoomTurnEnvelope;
  readonly source: Record<string, unknown>;
}
export interface OriginalRoomWakeAcceptance {
  collect(
    input: {
      roomId: string;
      roomMessageId: string;
      logicalAgentIds: readonly string[];
    },
    context: RoomTurnCustody,
  ): Promise<readonly OriginalRoomWakeCandidate[]>;
  claim(
    input: {
      roomId: string;
      roomMessageId: string;
      logicalAgentId: string;
      hostParticipantId: string;
    },
    context: RoomTurnCustody,
  ): Promise<Record<string, unknown>>;
}
export function readOriginalRoomWakeAcceptance(
  dispatcher: object,
): OriginalRoomWakeAcceptance {
  const entry = dispatcherApply(dispatcherGet, originalDispatchers, [
    dispatcher,
  ]) as OriginalRoomWakeAcceptance | undefined;
  if (!entry) throw Error('ROOM_TURN_ORIGINAL_DISPATCHER_REQUIRED');
  return entry;
}
interface RoomWakeBrokerPort {
  getRoomSnapshot(roomId: string): Promise<unknown>;
  claimWake(input: unknown): Promise<unknown>;
  completeWake(input: unknown): Promise<unknown>;
  abandonWake?(input: { roomId: string; claimToken: string; reason: string }): Promise<unknown>;
  /**
   * design §6.2：agent-only 受控按需补取。不是每次唤醒都调用——默认低成本
   * 窗口仍由 getRoomSnapshot + buildRoomContextWindow 在内存中截取。这个方法
   * 是给 Agent 在判断当前窗口不完整、需要进一步查询历史时使用的能力，接入点
   * 是后续的 agent-facing 工具注册（design §6.2 的 getRoomMessagesPage 语义
   * wrapper），dispatcher 本身不强制调用。
   */
  listRoomMessagesPage?(input: {
    roomId: string;
    claimToken: string;
    afterSequence?: number;
    beforeSequence?: number;
    limit?: number;
  }): Promise<unknown>;
}

export interface CollaborationRoomTurnEnvelope {
  roomId: string;
  roomTitle: string;
  roomRevision: number;
  roomMessageId: string;
  logicalAgentId: string;
  contextScope: { kind: string; projectId?: string };
  attachmentPaths: string[];
  contextWindow: RoomContextWindow;
  messages: Array<{
    messageId: string;
    sender: unknown;
    kind: string;
    text?: string;
    replyToMessageId?: string;
    contextScope?: { kind: string; projectId?: string };
  }>;
}

/**
 * design §6.1：Room 唤醒上下文完整性证明。totalMessages/fromSequence/toSequence
 * 的域冻结为该 roomId 的完整 room_sequence 域（所有 user/agent/system/artifact
 * message kind），不按 text/kind 二次过滤；默认 20 条窗口与分页都在同一域计算。
 */
export interface RoomContextWindow {
  fromSequence: number;
  toSequence: number;
  totalMessages: number;
  isComplete: boolean;
  truncatedBeforeSequence?: number;
  snapshotAt: string;
}

/**
 * design §6.1/§6.2：唯一的窗口选择函数——buildRoomContextWindow。契约测试
 * 守护这一个 seam，禁止新的手写 `.slice(-N)` 注入路径。
 *
 * roomMessages 必须是该 roomId 的完整 room_sequence 域快照（未经 kind 过滤），
 * windowSize 是本次唤醒实际选用的窗口大小（当前默认 20 条，与设计文档 §6.2
 * 分页常量的默认 50 是两个不同的场景——这里是"默认低成本窗口"，分页是"按需
 * 补取"）。
 */
export function buildRoomContextWindow(
  roomMessages: Array<Record<string, unknown>>,
  { windowSize = 20, now = new Date() }: { windowSize?: number; now?: Date } = {},
): { window: RoomContextWindow; windowedMessages: Array<Record<string, unknown>> } {
  const sorted: Array<Record<string, unknown>>=[];
  for(let i=0;i<roomMessages.length;i++)appendIntrinsic(sorted,roomMessages[i]!);
  dispatcherApply(roomSort,sorted,[(a:Record<string,unknown>, b:Record<string,unknown>) => {
    const seqA = Number(a.roomSequence ?? 0);
    const seqB = Number(b.roomSequence ?? 0);
    return seqA - seqB;
  }]);
  const totalMessages = sorted.length;
  const windowedMessages = dispatcherApply(roomSlice,sorted,[-windowSize]) as Array<Record<string,unknown>>;
  const isComplete = windowedMessages.length === totalMessages;
  const fromSequence = windowedMessages.length > 0 ? Number(windowedMessages[0].roomSequence ?? 0) : 0;
  const toSequence = windowedMessages.length > 0
    ? Number(windowedMessages[windowedMessages.length - 1].roomSequence ?? 0)
    : 0;
  const truncatedBeforeSequence = !isComplete && sorted.length > windowedMessages.length
    ? fromSequence
    : undefined;

  return {
    window: {
      fromSequence,
      toSequence,
      totalMessages,
      isComplete,
      ...(truncatedBeforeSequence !== undefined ? { truncatedBeforeSequence } : {}),
      snapshotAt: now.toISOString(),
    },
    windowedMessages,
  };
}

function originalTurnEnvelope(roomId:string,roomMessageId:string,logicalAgentId:string,room:Record<string,unknown>,source:Record<string,unknown>,scopedMessages:Array<Record<string,unknown>>,attachmentPaths:string[]):CollaborationRoomTurnEnvelope {
 const {window:contextWindow,windowedMessages}=buildRoomContextWindow(scopedMessages);
 const messages:CollaborationRoomTurnEnvelope['messages']=[];
 for(let i=0;i<windowedMessages.length;i++){const message=windowedMessages[i]!;appendIntrinsic(messages,{messageId:asString(message.messageId),sender:message.sender,kind:asString(message.kind),...(asString(message.text)?{text:asString(message.text)}:{}),...(asString(message.replyToMessageId)?{replyToMessageId:asString(message.replyToMessageId)}:{}),...(isRecord(message.contextScope)?{contextScope:message.contextScope as {kind:string;projectId?:string}}:{})});}
 return {roomId,roomTitle:asString(room.title),roomRevision:Number(room.revision||0),roomMessageId,logicalAgentId,attachmentPaths,contextScope:isRecord(source.contextScope)?source.contextScope as {kind:string;projectId?:string}:{kind:'room_only'},contextWindow,messages};
}

/**
 * design §6.2：consumer boundary runtime schema。desktop-services.ts:
 * runCollaborationRoomAgentTask 在组装 prompt 之前必须调用本函数；
 * contextWindow 缺失、sequence 不连续、或 message 边界/total/isComplete
 * 不一致时拒绝执行，不退回"默认完整"。
 *
 * 这是 call-graph/AST allowlist 契约测试守护的唯一 producer/consumer 边界——
 * 新增 producer 即使不命名 TypeScript 类型，也必须过这个 runtime validator。
 */
export function parseCollaborationRoomTurnEnvelope(
  envelope: unknown,
): { ok: true; envelope: CollaborationRoomTurnEnvelope } | { ok: false; error: string } {
  if (!isRecord(envelope)) return { ok: false, error: 'envelope_not_object' };
  const contextWindow = envelope.contextWindow;
  if (!isRecord(contextWindow)) return { ok: false, error: 'contextWindow_required' };
  if (typeof contextWindow.fromSequence !== 'number' || typeof contextWindow.toSequence !== 'number') {
    return { ok: false, error: 'contextWindow_sequence_invalid' };
  }
  if (typeof contextWindow.totalMessages !== 'number' || typeof contextWindow.isComplete !== 'boolean') {
    return { ok: false, error: 'contextWindow_fields_invalid' };
  }
  const messages = Array.isArray(envelope.messages) ? envelope.messages : null;
  if (!messages) return { ok: false, error: 'messages_required' };

  // sequence 连续性校验：envelope.messages 本身不携带 roomSequence 字段
  // （只有 messageId/sender/kind/text/...），所以这里校验的是 contextWindow
  // 自身声明的边界与消息数量是否一致，而不是逐条 message 的 roomSequence
  // （那属于生产者 buildRoomContextWindow 的职责，已在生成时保证）。若
  // isComplete=true 但 totalMessages 与 messages.length 不一致，或
  // fromSequence > toSequence，视为不一致，拒绝执行。
  if (contextWindow.fromSequence > contextWindow.toSequence && messages.length > 0) {
    return { ok: false, error: 'contextWindow_sequence_range_invalid' };
  }
  if (contextWindow.isComplete === true && contextWindow.totalMessages !== messages.length) {
    return { ok: false, error: 'contextWindow_total_mismatch' };
  }

  return { ok: true, envelope: envelope as unknown as CollaborationRoomTurnEnvelope };
}

export type CollaborationRoomDispatchEvent =
  | {
      type: 'wake_settled';
      roomId: string;
      roomMessageId: string;
      logicalAgentId: string;
      outcome: 'completed' | 'failed';
      remaining: number;
    }
  | {
      type: 'discussion_settled';
      roomId: string;
      roomMessageId: string;
      completed: string[];
      failed: string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createCollaborationRoomWakeDispatcher({
  brokerClient,
  execute,
  executeTurn,
  canExecute = async () => true,
  onEvent,
}: {
  brokerClient: RoomWakeBrokerPort;
  // design §6.2 RoomHistoryReadCapability：claimToken 与 envelope 分开传递，
  // 不混入 CollaborationRoomTurnEnvelope（那是受 runtime schema 保护、要
  // 进入 agent prompt 构造的结构，claimToken 是敏感身份信息，不应该有机会
  // 被误放进模型可见的字段里）。execute 的调用方（desktop-services.ts:
  // runCollaborationRoomAgentTask）用这个参数在 host.createTask 产出真实
  // taskId 后调用 registerRoomHistoryCapability，任务结束后释放。
  execute(input: CollaborationRoomTurnEnvelope, claimToken: string): Promise<{ text: string }>;
  executeTurn?(input: CollaborationRoomTurnEnvelope): Promise<{ ok: boolean }>;
  canExecute?(logicalAgentId: string): Promise<boolean>;
  onEvent?(event: CollaborationRoomDispatchEvent): void | Promise<void>;
}) {
  async function emit(event: CollaborationRoomDispatchEvent): Promise<void> {
    try {
      await onEvent?.(event);
    } catch {
      // UI notification is best-effort and must not change durable wake state.
    }
  }

  async function dispatchMessage(input: {
    roomId: string;
    roomMessageId: string;
    logicalAgentIds: string[];
  }) {
    const logicalAgentIds = [...new Set(input.logicalAgentIds)].sort();
    const completed: string[] = [];
    const failed: string[] = [];
    const settleAgent = async (logicalAgentId: string, outcome: 'completed' | 'failed') => {
      (outcome === 'completed' ? completed : failed).push(logicalAgentId);
      await emit({
        type: 'wake_settled',
        roomId: input.roomId,
        roomMessageId: input.roomMessageId,
        logicalAgentId,
        outcome,
        remaining: Math.max(0, logicalAgentIds.length - completed.length - failed.length),
      });
    };
    const finish = async () => {
      await emit({
        type: 'discussion_settled',
        roomId: input.roomId,
        roomMessageId: input.roomMessageId,
        completed: [...completed],
        failed: [...failed],
      });
    };

    const snapshot = await brokerClient.getRoomSnapshot(input.roomId);
    if (!isRecord(snapshot) || snapshot.ok === false || !isRecord(snapshot.room)) {
      failed.push(...logicalAgentIds);
      await finish();
      return { ok: false, code: asString(snapshot && isRecord(snapshot) ? snapshot.code : '') || 'broker_unavailable' };
    }
    const room = snapshot.room;
    const roomMessages = Array.isArray(snapshot.messages)
      ? snapshot.messages.filter((message): message is Record<string, unknown> => (
          isRecord(message) && message.roomId === input.roomId
        ))
      : [];
    const source = roomMessages.find(message => message.messageId === input.roomMessageId);
    if (!source) {
      failed.push(...logicalAgentIds);
      await finish();
      return { ok: false, code: 'room_message_not_found' };
    }
    const sourceScope = isRecord(source.contextScope) ? source.contextScope : { kind: 'room_only' };
    const scopedMessages = roomMessages.filter(message => {
      const scope = isRecord(message.contextScope) ? message.contextScope : { kind: 'room_only' };
      return scope.kind === sourceScope.kind && (scope.kind !== 'project' || scope.projectId === sourceScope.projectId);
    });
    const sourceRef = isRecord(source.sourceRef) ? source.sourceRef : null;
    const attachmentPaths = sourceRef?.kind === 'user_attachments' && Array.isArray(sourceRef.attachments)
      ? sourceRef.attachments.flatMap((attachment) => (
          isRecord(attachment) && asString(attachment.filePath)
            ? [asString(attachment.filePath)]
            : []
        ))
      : [];

    await Promise.all(logicalAgentIds.map(async logicalAgentId => {
      if (!(await canExecute(logicalAgentId))) {
        await settleAgent(logicalAgentId, 'failed');
        return;
      }
      if (executeTurn) {
        try {
          const outcome = await executeTurn(originalTurnEnvelope(input.roomId,input.roomMessageId,logicalAgentId,room,source,scopedMessages,attachmentPaths));
          await settleAgent(logicalAgentId, outcome.ok ? 'completed' : 'failed');
        } catch { await settleAgent(logicalAgentId, 'failed'); }
        return;
      }
      const claim = await brokerClient.claimWake({
        roomId: input.roomId,
        roomMessageId: input.roomMessageId,
        logicalAgentId,
        hostParticipantId: 'xiaok-desktop',
      });
      if (!isRecord(claim) || claim.ok === false || !asString(claim.claimToken)) {
        await settleAgent(logicalAgentId, 'failed');
        return;
      }
      let wakeCompleted = false;
      try {
        const { window: contextWindow, windowedMessages } = buildRoomContextWindow(scopedMessages);
        const output = await execute({
          roomId: input.roomId,
          roomTitle: asString(room.title),
          roomRevision: Number(room.revision || 0),
          roomMessageId: input.roomMessageId,
          logicalAgentId,
          attachmentPaths,
          contextScope: isRecord(source.contextScope)
            ? source.contextScope as { kind: string; projectId?: string }
            : { kind: 'room_only' },
          contextWindow,
          messages: windowedMessages.map(message => ({
            messageId: asString(message.messageId),
            sender: message.sender,
            kind: asString(message.kind),
            ...(asString(message.text) ? { text: asString(message.text) } : {}),
            ...(asString(message.replyToMessageId) ? { replyToMessageId: asString(message.replyToMessageId) } : {}),
            ...(isRecord(message.contextScope)
              ? { contextScope: message.contextScope as { kind: string; projectId?: string } }
              : {}),
          })),
        }, asString(claim.claimToken));
        const text = asString(output?.text).trim();
        const settled = await brokerClient.completeWake({
          roomId: input.roomId,
          claimToken: claim.claimToken,
          reply: text ? { kind: 'text', text } : { kind: 'pass' },
        });
        if (!isRecord(settled) || settled.ok === false) {
          await settleAgent(logicalAgentId, 'failed');
          return;
        }
        wakeCompleted = true;
        await settleAgent(logicalAgentId, 'completed');
      } catch {
        await settleAgent(logicalAgentId, 'failed');
      } finally {
        if (!wakeCompleted) await brokerClient.abandonWake?.({ roomId: input.roomId, claimToken: asString(claim.claimToken), reason: 'execution_failed' }).catch(() => undefined);
      }
    }));
    completed.sort(); failed.sort();
    await finish();
    return { ok: true, completed, failed };
  }

  const originalDispatcher={dispatchMessage};
  const collect=async(input:{roomId:string;roomMessageId:string;logicalAgentIds:readonly string[]},context:RoomTurnCustody):Promise<readonly OriginalRoomWakeCandidate[]>=>{
    const scoped=readOptionalOriginalScopedRoomWakeAcceptance(brokerClient);
    const raw=scoped?await scoped.collect(input,context):await readOriginalRoomSnapshot(brokerClient,context,input.roomId);
    const snapshot=captureDispatchBusinessData(raw,value=>context.inventory(value)) as Record<string,unknown>;
    if(snapshot.ok!==true||!isRecord(snapshot.room)||snapshot.room.roomId!==input.roomId||snapshot.room.status!=='active'||!Array.isArray(snapshot.messages)||!Array.isArray(snapshot.members))throw Error('ROOM_TURN_SNAPSHOT_UNAVAILABLE');
    let source:Record<string,unknown>|undefined;const roomMessages:Array<Record<string,unknown>>=[];
    for(let i=0;i<snapshot.messages.length;i++){const message=snapshot.messages[i];if(isRecord(message)&&message.roomId===input.roomId){appendIntrinsic(roomMessages,message);if(message.messageId===input.roomMessageId)source=message;}}
    if(!source)throw Error('ROOM_TURN_MESSAGE_NOT_FOUND');
    const sourceScope=isRecord(source.contextScope)?source.contextScope:{kind:'room_only'},scopedMessages:Array<Record<string,unknown>>=[],attachments:string[]=[];
    for(let i=0;i<roomMessages.length;i++){const message=roomMessages[i]!,scope=isRecord(message.contextScope)?message.contextScope:{kind:'room_only'};if(scope.kind===sourceScope.kind&&(scope.kind!=='project'||scope.projectId===sourceScope.projectId))appendIntrinsic(scopedMessages,message);}
    const sourceRef=isRecord(source.sourceRef)?source.sourceRef:null;
    if(sourceRef?.kind==='user_attachments'&&Array.isArray(sourceRef.attachments))for(let i=0;i<sourceRef.attachments.length;i++){const attachment=sourceRef.attachments[i];if(isRecord(attachment)&&asString(attachment.filePath))appendIntrinsic(attachments,asString(attachment.filePath));}
    const candidates:OriginalRoomWakeCandidate[]=[];
    for(let i=0;i<input.logicalAgentIds.length;i++){
      const agent=input.logicalAgentIds[i]!;let member=false;
      for(let j=0;j<snapshot.members.length;j++){const row=snapshot.members[j];if(isRecord(row)&&row.status==='active'&&isRecord(row.subject)&&row.subject.kind==='agent'&&row.subject.logicalAgentId===agent)member=true;}
      if(!member)throw Error('ROOM_TURN_MEMBERSHIP_REQUIRED');
      if(await context.sdk<boolean>(canExecute,undefined,[agent])!==true)throw Error('ROOM_TURN_UNSUPPORTED');context.current();
      appendIntrinsic(candidates,{source,envelope:originalTurnEnvelope(input.roomId,input.roomMessageId,agent,snapshot.room,source,scopedMessages,attachments)});
    }
    context.current();roomSetPrototype(candidates,null);return roomFreeze(candidates);
  };
  dispatcherApply(dispatcherSet,originalDispatcherClients,[originalDispatcher,brokerClient]);
  dispatcherApply(dispatcherSet,originalDispatchers,[originalDispatcher,roomFreeze({collect,claim:(input:{roomId:string;roomMessageId:string;logicalAgentId:string;hostParticipantId:string},context:RoomTurnCustody)=>{
    const scoped=readOptionalOriginalScopedRoomWakeAcceptance(brokerClient);
    return scoped?scoped.claim(input,context):claimOriginalRoomWake(brokerClient,context,input);
  }})]);
  return originalDispatcher;
}
