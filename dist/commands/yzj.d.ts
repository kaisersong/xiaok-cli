import type { Command } from 'commander';
import type { YZJChannelConfig } from '../types.js';
interface YZJServeOptions {
    sendMsgUrl?: string;
    inboundMode?: 'webhook' | 'websocket';
    webhookPath?: string;
    webhookPort?: string;
    secret?: string;
    webhook?: boolean;
    dryRun?: boolean;
}
export declare function shouldStartYZJWebSocket(yzjConfig: Pick<YZJChannelConfig, 'inboundMode'>, options: Pick<YZJServeOptions, 'dryRun'>): boolean;
export declare function registerYZJCommands(program: Command): void;
export {};
