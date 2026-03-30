import type { Config, YZJChannelConfig } from '../types.js';
import type { ChannelRequest } from './webhook.js';
import type { YZJIncomingMessage, YZJResolvedConfig } from './yzj-types.js';
export declare function resolveYZJConfig(config: Config, overrides?: Partial<YZJChannelConfig>): YZJResolvedConfig;
export declare function parseYZJMessage(message: YZJIncomingMessage): ChannelRequest;
