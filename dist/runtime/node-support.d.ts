export declare const MIN_NODE_VERSION = "22.14.0";
export declare function isNodeVersionAtLeast(version: string, minimum: string): boolean;
export declare function shouldBlockChatOnOldNode(input: {
    platform: string;
    version: string;
    print: boolean;
    json: boolean;
}): boolean;
export declare function oldNodeMessage(version: string): string;
