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
  /** 最近一次向本 channel 发消息的用户，用于把确认请求推回给他。 */
  private lastReplyTarget: ChannelReplyTarget | null = null;

  constructor(options: EmbeddedYZJChannelOptions) {
    this.options = options;
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

    const command = parseYZJCommand(msg.content);

    if (command.kind === 'approve') {
      approvalStore.resolve(command.approvalId, 'approve');
      return;
    }

    if (command.kind === 'deny') {
      approvalStore.resolve(command.approvalId, 'deny');
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
    this.lastReplyTarget = replyTarget;

    // 普通文本 → 运行 turn，收集 text chunks，推送回复
    const textParts: string[] = [];
    const onChunk = (chunk: StreamChunk) => {
      if (chunk.type === 'text') {
        textParts.push(chunk.delta);
      }
    };

    try {
      await runtimeFacade.runTurn(
        { sessionId, cwd, source: 'yzj', input: msg.content },
        onChunk,
      );
    } catch (err) {
      process.stderr.write(`[yzjchannel] runTurn error: ${String(err)}\n`);
      return;
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

    await this.options.transport.deliver(outbound);
  }

  /**
   * 合并终端确认与 channel 确认：任何一侧给出明确决定即生效，绝不自动批准。
   * - 终端确认照常弹出；
   * - 若已知 channel 用户，同时把确认请求推送到 channel，只有显式 /approve 才算批准；
   * - channel 侧超时、推送失败或其他错误一律按拒绝处理；
   * - 尚无 channel 用户时，channel 侧不参与决定，由终端确认决定。
   */
  makeOnPrompt(
    tuiOnPrompt: (toolName: string, input: Record<string, unknown>) => Promise<boolean>,
  ): (toolName: string, input: Record<string, unknown>) => Promise<boolean> {
    return async (toolName: string, input: Record<string, unknown>) => {
      const channelRequest = this.requestChannelApproval(toolName, input);
      try {
        return await new Promise<boolean>((resolve) => {
          tuiOnPrompt(toolName, input).then(
            (decision) => resolve(decision === true),
            () => resolve(false),
          );
          channelRequest.decision.then(
            (decision) => {
              if (decision !== undefined) resolve(decision);
            },
            () => resolve(false),
          );
        });
      } finally {
        channelRequest.cancel();
      }
    };
  }

  /**
   * 向 channel 用户发起一次确认。decision：true=显式批准，false=拒绝/超时/出错，
   * undefined=没有可推送的 channel 用户（不参与决定）。
   */
  private requestChannelApproval(
    toolName: string,
    input: Record<string, unknown>,
  ): { decision: Promise<boolean | undefined>; cancel: () => void } {
    const replyTarget = this.lastReplyTarget;
    if (!replyTarget) {
      return { decision: Promise.resolve(undefined), cancel: () => {} };
    }

    const { approvalStore, sessionId, approvalTimeoutMs } = this.options;
    let approvalId: string | undefined;
    const cancel = () => {
      if (approvalId && approvalStore.get(approvalId)) {
        approvalStore.expire(approvalId);
      }
    };

    const decision = (async (): Promise<boolean> => {
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
        const waiting = approvalStore.waitForDecision(approval.approvalId);
        await this.pushApprovalRequest(approval.approvalId, summary, replyTarget);
        const result = await waiting;
        return result === 'approve';
      } catch (err) {
        process.stderr.write(`[yzjchannel] approval request failed, denying: ${String(err)}\n`);
        cancel();
        return false;
      }
    })();

    return { decision, cancel };
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
