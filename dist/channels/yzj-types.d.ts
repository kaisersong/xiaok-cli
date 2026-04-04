import type { YZJInboundMode } from '../types.js';
export { type YZJChannelConfig, type YZJInboundMode } from '../types.js';
export interface YZJIncomingMessage {
    type: number;
    robotId: string;
    robotName: string;
    operatorOpenid: string;
    operatorName: string;
    time: number;
    msgId: string;
    content: string;
    groupType: number;
}
export interface YZJResponse {
    success: boolean;
    data: {
        type: number;
        content: string;
    };
    error?: string;
}
export interface YZJResolvedConfig {
    webhookUrl: string;
    inboundMode: YZJInboundMode;
    webhookPath: string;
    webhookPort: number;
    secret?: string;
}
export interface YZJLogger {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
}
export interface SignatureVerificationResult {
    valid: boolean;
    error?: string;
}
