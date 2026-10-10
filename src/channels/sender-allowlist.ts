export const SENDER_DENIED_REPLY = '你没有权限使用这个助手。';
export const SENDER_ALLOWLIST_MIGRATION = '未配置云之家发送人白名单，所有入站消息将被拒绝。请配置 channels.yzj.allowedSenders（openid 字符串数组）；namedChannels 中可单独覆盖 allowedSenders（仅 /yzjchannel）。';

export function normalizeAllowedSenders(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim()).filter(Boolean);
}

export function checkSenderAllowed(operatorOpenid: string, allowedSenders: string[] | undefined): { allowed: boolean; reason: string } {
  // 发送人侧严格 ===，不做空白/大小写归一；配置侧只在加载时 trim。
  if (typeof operatorOpenid !== 'string' || !operatorOpenid.trim()) {
    return { allowed: false, reason: 'invalid_sender' };
  }
  if (!Array.isArray(allowedSenders) || allowedSenders.length === 0) {
    return { allowed: false, reason: 'empty_allowlist' };
  }
  return allowedSenders.some(sender => sender === operatorOpenid)
    ? { allowed: true, reason: 'allowed' }
    : { allowed: false, reason: 'sender_not_allowed' };
}

const MAX_RATE_LIMIT_ENTRIES = 256;

/** 两条入站路径共用的拒绝日志与回复限速；不接收消息正文。 */
export class SenderAllowlistGuard {
  private readonly lastReplies = new Map<string, number>();

  constructor(
    private readonly allowedSenders: string[] | undefined,
    private readonly log: (message: string) => void = message => { process.stderr.write(`${message}\n`); },
    private readonly now: () => number = Date.now,
  ) {}

  async accept(operatorOpenid: string, reply: (text: string) => Promise<unknown>): Promise<boolean> {
    const result = checkSenderAllowed(operatorOpenid, this.allowedSenders);
    if (result.allowed) return true;
    const sender = typeof operatorOpenid === 'string' ? operatorOpenid : '<invalid>';
    this.log(`[yzj] sender=${JSON.stringify(sender)} reason=${result.reason}`);
    // 无有效收件人时只记录，不尝试广播拒绝回复。
    if (result.reason === 'invalid_sender') return false;
    const now = this.now();
    const last = this.lastReplies.get(sender);
    if (last === undefined || now - last >= 60_000) {
      this.lastReplies.set(sender, now);
      this.pruneRateLimitMap(now);
      try { await reply(SENDER_DENIED_REPLY); } catch { /* 拒绝回复失败不改变授权结果。 */ }
    }
    return false;
  }

  private pruneRateLimitMap(now: number): void {
    for (const [key, at] of this.lastReplies) {
      if (now - at >= 60_000) this.lastReplies.delete(key);
    }
    while (this.lastReplies.size > MAX_RATE_LIMIT_ENTRIES) {
      const oldest = this.lastReplies.keys().next().value;
      if (oldest === undefined) break;
      this.lastReplies.delete(oldest);
    }
  }
}
