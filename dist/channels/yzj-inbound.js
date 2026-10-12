import { SenderAllowlistGuard } from './sender-allowlist.js';
/** serve 的统一入站入口，授权成功后才能创建会话或解析命令。 */
export function createYZJInboundProcessor(options) {
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
        })))
            return;
        await options.execute(message, source);
    };
}
