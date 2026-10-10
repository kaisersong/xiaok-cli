import { SenderAllowlistGuard } from './sender-allowlist.js';
import type { YZJIncomingMessage } from './yzj-types.js';
import type { OutboundChannelMessage } from './types.js';

type InboundSource = 'webhook' | 'websocket';

/** serve 的统一入站入口，授权成功后才能创建会话或解析命令。 */
export function createYZJInboundProcessor(options: {
  allowedSenders?: string[];
  markSeen: (messageId: string) => boolean;
  deliver: (message: OutboundChannelMessage) => Promise<unknown>;
  execute: (message: YZJIncomingMessage, source: InboundSource) => Promise<unknown>;
  log: (message: string) => void;
}): (message: YZJIncomingMessage, source: InboundSource) => Promise<void> {
  const guard = new SenderAllowlistGuard(options.allowedSenders, options.log);
  return async (message, source) => {
    if (!options.markSeen(message.msgId)) {
      options.log(`[yzj] duplicate inbound dropped from ${source}: ${message.msgId}`);
      return;
    }
    if (!await guard.accept(message.operatorOpenid, text => options.deliver({
      channel: 'yzj',
      target: { chatId: message.robotId, userId: message.operatorOpenid, messageId: message.msgId },
      text, kind: 'text',
    }))) return;
    await options.execute(message, source);
  };
}
