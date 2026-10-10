import { getTurnOrigin } from './turn-origin.js';
import { SenderAllowlistGuard, normalizeAllowedSenders } from './sender-allowlist.js';
import type { EmbeddedChannel } from './embedded-channel.js';
import { YZJWebSocketClient } from './yzj-websocket-client.js';
import { createYZJWebhookHandler } from './yzj-webhook.js';
import type { YZJTransport } from './yzj-transport.js';
import { parseYZJCommand } from './command-parser.js';
import { deriveYZJWebSocketUrl } from './yzj-ws-url.js';
import type { ApprovalStore } from './approval-store.js';
import type { ChannelReplyTarget, OutboundChannelMessage } from './types.js';
import type { YZJIncomingMessage, YZJResolvedConfig } from './yzj-types.js';
import type { YZJNamedChannel } from '../types.js';
import type { RuntimeFacade } from '../ai/runtime/runtime-facade.js';
import type { RuntimeHooks } from '../runtime/hooks.js';
import type { StreamChunk } from '../types.js';
import { buildPermissionRequest } from '../ui/permission-prompt.js';
import { createServer, type Server } from 'node:http';

export interface EmbeddedYZJChannelOptions {
  allowedSenders?: string[];
  runtimeFacade: RuntimeFacade;
  runtimeHooks: RuntimeHooks;
  approvalStore: ApprovalStore;
  /** channel 侧确认的等待时长，超时按拒绝处理；默认沿用 ApprovalStore 的 5 分钟。 */
  approvalTimeoutMs?: number;
  transport: Pick<YZJTransport, 'deliver'>;
  selectedChannel: YZJNamedChannel;
  yzjConfig: YZJResolvedConfig;
  sessionId: string;
  cwd: string;
}

export class EmbeddedYZJChannel implements EmbeddedChannel {
  private readonly options: EmbeddedYZJChannelOptions;
  private wsClient: YZJWebSocketClient | null = null;
  private httpServer: Server | null = null;
  /** 只用于定位明确来源的活动回合回复目标。 */
  private readonly activeTurnTargets = new Set<ChannelReplyTarget>();
  /** 本 channel 发出的确认请求 → 允许回复它的用户 openid。 */
  private readonly approvalOwners = new Map<string, string | undefined>();

  private readonly senderGuard: SenderAllowlistGuard;

  constructor(options: EmbeddedYZJChannelOptions) {
    this.options = options;
    this.senderGuard = new SenderAllowlistGuard(normalizeAllowedSenders(options.allowedSenders ?? options.selectedChannel.allowedSenders ?? options.yzjConfig.allowedSenders));
  }

  async start(): Promise<void> {
    const { yzjConfig } = this.options;

    if (yzjConfig.inboundMode === 'websocket') {
      const wsUrl = deriveYZJWebSocketUrl(yzjConfig.webhookUrl);
      this.wsClient = new YZJWebSocketClient({
        url: wsUrl,
        onMessage: (msg) => this.handleInbound(msg),
      });
      this.wsClient.start();
    } else {
      // webhook mode
      const handler = createYZJWebhookHandler({
        path: yzjConfig.webhookPath,
        secret: yzjConfig.secret,
        onMessage: (msg) => this.handleInbound(msg),
      });

      this.httpServer = createServer((req, res) => {
        void handler(req, res);
      });

      await new Promise<void>((resolve) => {
        this.httpServer!.listen(yzjConfig.webhookPort, resolve);
      });
    }
  }

  async cleanup(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.stop();
      this.wsClient = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.httpServer = null;
    }
  }

  private async handleInbound(msg: YZJIncomingMessage): Promise<void> {
    const { selectedChannel, approvalStore, runtimeFacade, sessionId, cwd, transport } = this.options;

    // 过滤非匹配 robotId
    if (msg.robotId !== selectedChannel.robotId) {
      return;
    }

    if (!await this.senderGuard.accept(msg.operatorOpenid, text => transport.deliver({
      channel: 'yzj', target: { chatId: msg.robotId, userId: msg.operatorOpenid, messageId: msg.msgId },
      text, kind: 'text',
    }))) return;

    const command = parseYZJCommand(msg.content);

    if (command.kind === 'approve' || command.kind === 'deny') {
      if (!this.isAllowedApprover(command.approvalId, msg.operatorOpenid)) {
        process.stderr.write(`[yzjchannel] ignored ${command.kind} for ${command.approvalId}: unknown approval or not the requester\n`);
        return;
      }
      approvalStore.resolve(command.approvalId, command.kind);
      return;
    }

    const replyTarget: ChannelReplyTarget = {
      chatId: msg.robotId,
      userId: msg.operatorOpenid,
      messageId: msg.msgId,
      metadata: {
        operatorName: msg.operatorName,
        replySummary: msg.content.slice(0, 100),
      },
    };

    // 普通文本 → 运行 turn，收集 text chunks，推送回复
    const textParts: string[] = [];
    const onChunk = (chunk: StreamChunk) => {
      if (chunk.type === 'text') {
        textParts.push(chunk.delta);
      }
    };

    this.activeTurnTargets.add(replyTarget);
    try {
      await runtimeFacade.runTurn(
        { sessionId, cwd, source: 'yzj', initiator: msg.operatorOpenid, channelTurnId: msg.msgId, input: msg.content },
        onChunk,
      );
    } catch (err) {
      process.stderr.write(`[yzjchannel] runTurn error: ${String(err)}\n`);
      return;
    } finally {
      this.activeTurnTargets.delete(replyTarget);
    }

    const reply = textParts.join('');
    if (!reply.trim()) {
      return;
    }

    const outbound: OutboundChannelMessage = {
      channel: 'yzj',
      target: replyTarget,
      text: reply,
      kind: 'text',
    };

    await transport.deliver(outbound);
  }

  async pushApprovalRequest(
    approvalId: string,
    summary: string,
    replyTarget: ChannelReplyTarget,
    signal?: AbortSignal,
  ): Promise<void> {
    const text = [
      '⚠️ 需要确认',
      `操作摘要：${summary}`,
      `审批 ID：${approvalId}`,
      `发送 /approve ${approvalId} 批准，或 /deny ${approvalId} 拒绝`,
    ].join('\n');

    const outbound: OutboundChannelMessage = {
      channel: 'yzj',
      target: replyTarget,
      text,
      kind: 'approval',
      approvalId,
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      await Promise.race([
        this.options.transport.deliver(outbound),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new Error('approval delivery withdrawn'));
          signal?.addEventListener('abort', onAbort, { once: true });
          timer = setTimeout(() => reject(new Error('approval delivery timeout')), 10_000);
          if (signal?.aborted) onAbort();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * 合并终端确认与 channel 确认：任何一侧给出明确决定即生效，绝不自动批准。
   * - 终端确认照常弹出；
   * - 当前 turn 由 channel 消息发起时，同时把确认请求推送给发起人，只有他显式 /approve 才算批准；
   * - channel 确认等待超时按拒绝处理；推送失败则退出 race；
   * - 终端发起的 turn 不推送到 channel，由终端确认决定。
   */
  makeOnPrompt(
    tuiOnPrompt: (toolName: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<boolean>,
  ): (toolName: string, input: Record<string, unknown>) => Promise<boolean> {
    return async (toolName: string, input: Record<string, unknown>) => {
      const controller = new AbortController();
      const channelRequest = this.requestChannelApproval(toolName, input);
      try {
        return await new Promise<boolean>((resolve) => {
          let settled = false;
          const finish = (decision: boolean, fromChannel = false) => {
            if (settled) return;
            settled = true;
            if (fromChannel) controller.abort();
            channelRequest.cancel();
            resolve(decision);
          };
          Promise.resolve().then(() => tuiOnPrompt(toolName, input, controller.signal)).then(
            decision => finish(decision === true),
            () => finish(false),
          );
          channelRequest.decision.then(
            decision => { if (decision !== undefined) finish(decision, true); },
            () => {},
          );
        });
      } finally {
        channelRequest.cancel();
      }
    };
  }

  /**
   * 向 channel 用户发起一次确认。decision：true=显式批准，false=拒绝/确认等待超时，
   * undefined=当前不是 channel 发起的 turn（不参与决定）。
   */
  private requestChannelApproval(
    toolName: string,
    input: Record<string, unknown>,
  ): { decision: Promise<boolean | undefined>; cancel: () => void } {
    const origin = getTurnOrigin();
    const targets = origin?.source === 'yzj' && origin.initiator
      ? [...this.activeTurnTargets].filter(target => target.userId === origin.initiator
        && (origin.channelTurnId === undefined || target.messageId === origin.channelTurnId))
      : [];
    const replyTarget = targets.length === 1 ? targets[0] : undefined;
    if (!replyTarget?.userId) {
      return { decision: Promise.resolve(undefined), cancel: () => {} };
    }

    const { approvalStore, sessionId, approvalTimeoutMs } = this.options;
    let approvalId: string | undefined;
    const deliveryController = new AbortController();
    const cancel = () => {
      deliveryController.abort();
      if (!approvalId) return;
      this.approvalOwners.delete(approvalId);
      if (approvalStore.get(approvalId)) {
        approvalStore.expire(approvalId);
      }
    };

    const decision = (async (): Promise<boolean | undefined> => {
      try {
        const summary = buildPermissionRequest(toolName, input).summary;
        const approval = approvalStore.create({
          sessionId,
          turnId: replyTarget.messageId ?? sessionId,
          toolName,
          summary,
          ...(approvalTimeoutMs !== undefined ? { timeoutMs: approvalTimeoutMs } : {}),
        });
        approvalId = approval.approvalId;
        this.approvalOwners.set(approval.approvalId, replyTarget.userId);
        const waiting = approvalStore.waitForDecision(approval.approvalId);
        await this.pushApprovalRequest(approval.approvalId, summary, replyTarget, deliveryController.signal);
        const result = await waiting;
        return result === 'approve';
      } catch (err) {
        if (!deliveryController.signal.aborted) process.stderr.write('[yzjchannel] 云之家推送失败，请在这里确认\n');
        cancel();
        return undefined;
      }
    })();

    return { decision, cancel };
  }

  /** 只接受本 channel 发出的、且由发起人本人回复的 /approve、/deny；其余一律忽略。 */
  private isAllowedApprover(approvalId: string, operatorOpenid: string): boolean {
    const owner = this.approvalOwners.get(approvalId);
    return owner !== undefined && owner === operatorOpenid;
  }

  // 测试用公开方法
  async handleInboundForTest(msg: YZJIncomingMessage): Promise<void> {
    return this.handleInbound(msg);
  }

  async pushApprovalRequestForTest(
    approvalId: string,
    summary: string,
    replyTarget: ChannelReplyTarget,
  ): Promise<void> {
    return this.pushApprovalRequest(approvalId, summary, replyTarget);
  }
}
