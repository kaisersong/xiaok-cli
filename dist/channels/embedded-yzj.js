import { YZJWebSocketClient } from './yzj-websocket-client.js';
import { createYZJWebhookHandler } from './yzj-webhook.js';
import { parseYZJCommand } from './command-parser.js';
import { deriveYZJWebSocketUrl } from './yzj-ws-url.js';
import { createServer } from 'node:http';
export class EmbeddedYZJChannel {
    options;
    wsClient = null;
    httpServer = null;
    constructor(options) {
        this.options = options;
    }
    async start() {
        const { yzjConfig } = this.options;
        if (yzjConfig.inboundMode === 'websocket') {
            const wsUrl = deriveYZJWebSocketUrl(yzjConfig.webhookUrl);
            this.wsClient = new YZJWebSocketClient({
                url: wsUrl,
                onMessage: (msg) => this.handleInbound(msg),
            });
            this.wsClient.start();
        }
        else {
            // webhook mode
            const handler = createYZJWebhookHandler({
                path: yzjConfig.webhookPath,
                secret: yzjConfig.secret,
                onMessage: (msg) => this.handleInbound(msg),
            });
            this.httpServer = createServer((req, res) => {
                void handler(req, res);
            });
            await new Promise((resolve) => {
                this.httpServer.listen(yzjConfig.webhookPort, resolve);
            });
        }
    }
    async cleanup() {
        if (this.wsClient) {
            this.wsClient.stop();
            this.wsClient = null;
        }
        if (this.httpServer) {
            await new Promise((resolve, reject) => {
                this.httpServer.close((err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            this.httpServer = null;
        }
    }
    async handleInbound(msg) {
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
        const textParts = [];
        const onChunk = (chunk) => {
            if (chunk.type === 'text') {
                textParts.push(chunk.delta);
            }
        };
        try {
            await runtimeFacade.runTurn({ sessionId, cwd, source: 'yzj', input: msg.content }, onChunk);
        }
        catch (err) {
            process.stderr.write(`[yzjchannel] runTurn error: ${String(err)}\n`);
            return;
        }
        const reply = textParts.join('');
        if (!reply.trim()) {
            return;
        }
        const replyTarget = {
            chatId: msg.robotId,
            userId: msg.operatorOpenid,
            messageId: msg.msgId,
            metadata: {
                operatorName: msg.operatorName,
                replySummary: msg.content.slice(0, 100),
            },
        };
        const outbound = {
            channel: 'yzj',
            target: replyTarget,
            text: reply,
            kind: 'text',
        };
        await transport.deliver(outbound);
    }
    async pushApprovalRequest(approvalId, summary, replyTarget) {
        const text = [
            '⚠️ 需要确认',
            `操作摘要：${summary}`,
            `审批 ID：${approvalId}`,
            `发送 /approve ${approvalId} 批准，或 /deny ${approvalId} 拒绝`,
        ].join('\n');
        const outbound = {
            channel: 'yzj',
            target: replyTarget,
            text,
            kind: 'approval',
            approvalId,
        };
        await this.options.transport.deliver(outbound);
    }
    makeOnPrompt(tuiOnPrompt) {
        return async (toolName, input) => {
            // Promise.race 取最先 resolve 的结果；另一侧 Promise 会继续运行至自然结束（副作用可重入）
            const result = await Promise.race([
                tuiOnPrompt(toolName, input),
                this.options.onPromptOverride(toolName, input),
            ]);
            return result;
        };
    }
    // 测试用公开方法
    async handleInboundForTest(msg) {
        return this.handleInbound(msg);
    }
    async pushApprovalRequestForTest(approvalId, summary, replyTarget) {
        return this.pushApprovalRequest(approvalId, summary, replyTarget);
    }
}
