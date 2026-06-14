/**
 * MCP Server Classification Registry
 *
 * xiaok 维护的运行时 policy 分类表,作为 activation / dispose ownership 的事实来源。
 * 不依赖插件作者填 manifest 字段;插件 manifest 上的 requiresUserActivation 仅作为
 * 向后兼容 fallback,且仅在官方 cua-computer-use 插件身份上生效(round-2 B1)。
 *
 * 内置 entry 必须按 pluginName + name 严格匹配,防止第三方同名 server 误命中
 * (round-2 B2)。
 *
 * 第二个 lazy adapter 出现前,本文件不抽象 generic lazy MCP support。
 */
import type { NamedMcpServerConfig } from './types.js';
export type McpActivation = {
    mode: 'eager';
} | {
    mode: 'lazy';
    adapter: 'cua-computer-use-wrapper';
};
export type McpDisposeOwnership = 'owned-child' | 'shared-singleton-never-stop';
export type McpDiagnosticTag = 'orphan-daemon-risk' | 'high-cpu-idle';
export interface McpServerPolicy {
    activation: McpActivation;
    disposeOwnership: McpDisposeOwnership;
    diagnostics: readonly McpDiagnosticTag[];
    reason: string;
    source: 'registry' | 'legacy-manifest' | 'default';
}
export interface McpClassificationEntry {
    match: {
        pluginName?: string;
        name: string;
    };
    policy: Omit<McpServerPolicy, 'source'>;
}
export declare const BUILT_IN_MCP_CLASSIFICATIONS: readonly McpClassificationEntry[];
/**
 * registry 加载/使用前的一致性校验。
 * - cua-computer-use-wrapper adapter 仅允许匹配官方 CUA 身份。
 *   防止 fake registry 把 wrapper 配在其他 server 上(round-2 m1)。
 */
export declare function validateRegistry(registry: readonly McpClassificationEntry[]): void;
/**
 * 计算 server 的 runtime policy。
 * 优先级: registry 命中 > legacy-manifest fallback > default eager。
 * 多条 registry 同时 match 直接 throw,避免第二条 entry 静默吞掉前者。
 */
export declare function classifyMcpServer(server: NamedMcpServerConfig, registry?: readonly McpClassificationEntry[]): McpServerPolicy;
