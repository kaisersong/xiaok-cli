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
import { createServer, type Server } from 'node:http';

export interface EmbeddedYZJChannelOptions {
  runtimeFacade: RuntimeFacade;
  runtimeHooks: RuntimeHooks;
  approvalStore: ApprovalStore;
  onPromptOverride: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
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

    const replyTarget: ChannelReplyTarget = {
      chatId: msg.robotId,
      userId: msg.operatorOpenid,
      messageId: msg.msgId,
      metadata: {
        operatorName: msg.operatorName,
        replySummary: msg.content.slice(0, 100),
      },
    };

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

  makeOnPrompt(
    tuiOnPrompt: (toolName: string, input: Record<string, unknown>) => Promise<boolean>,
  ): (toolName: string, input: Record<string, unknown>) => Promise<boolean> {
    return async (toolName: string, input: Record<string, unknown>) => {
      // 两侧都会执行到底，Promise.race 取最先 resolve 的结果
      const result = await Promise.race([
        tuiOnPrompt(toolName, input),
        this.options.onPromptOverride(toolName, input),
      ]);
      return result;
    };
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
