export declare const SENDER_DENIED_REPLY = "\u4F60\u6CA1\u6709\u6743\u9650\u4F7F\u7528\u8FD9\u4E2A\u52A9\u624B\u3002";
export declare const SENDER_ALLOWLIST_MIGRATION = "\u672A\u914D\u7F6E\u4E91\u4E4B\u5BB6\u53D1\u9001\u4EBA\u767D\u540D\u5355\uFF0C\u6240\u6709\u5165\u7AD9\u6D88\u606F\u5C06\u88AB\u62D2\u7EDD\u3002\u8BF7\u914D\u7F6E channels.yzj.allowedSenders\uFF08openid \u5B57\u7B26\u4E32\u6570\u7EC4\uFF09\uFF1BnamedChannels \u4E2D\u53EF\u5355\u72EC\u8986\u76D6 allowedSenders\uFF08\u4EC5 /yzjchannel\uFF09\u3002";
export declare function normalizeAllowedSenders(value: unknown): string[] | undefined;
export declare function checkSenderAllowed(operatorOpenid: string, allowedSenders: string[] | undefined): {
    allowed: boolean;
    reason: string;
};
/** 两条入站路径共用的拒绝日志与回复限速；不接收消息正文。 */
export declare class SenderAllowlistGuard {
    private readonly allowedSenders;
    private readonly log;
    private readonly now;
    private readonly lastReplies;
    constructor(allowedSenders: string[] | undefined, log?: (message: string) => void, now?: () => number);
    accept(operatorOpenid: string, reply: (text: string) => Promise<unknown>): Promise<boolean>;
    private pruneRateLimitMap;
}
