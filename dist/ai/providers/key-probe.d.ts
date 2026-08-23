import type { ProtocolId } from './types.js';
import type { CandidateApiKey } from './auth-resolver.js';
export type KeyProbeStatus = 'valid' | 'invalid' | 'network_error' | 'unknown_protocol';
export interface KeyProbeResult {
    status: KeyProbeStatus;
    /** HTTP 状态码（如果拿到了响应） */
    httpStatus?: number;
    /** 人类可读的失败原因，valid 时为空 */
    detail?: string;
}
export type { CandidateApiKey };
/**
 * 对单个候选 Key 发起一次最小化的只读请求（模型列表），验证其是否真正可用。
 * 不消耗生成 token，仅用于确认鉴权是否通过。
 *
 * 调用方需注意：这会发出真实网络请求，仅应在用户主动触发验证时调用
 * （如 `xiaok doctor --check-keys`），不应在普通命令路径中静默调用。
 */
export declare function probeApiKey(protocol: ProtocolId, baseUrl: string | undefined, apiKey: string): Promise<KeyProbeResult>;
/**
 * 依次验证多个候选 Key，返回第一个通过验证的结果（连同其索引），
 * 或在全部失败后返回每个候选的验证结果供诊断展示。
 */
export declare function probeCandidates(protocol: ProtocolId, baseUrl: string | undefined, candidates: CandidateApiKey[]): Promise<{
    candidate: CandidateApiKey;
    result: KeyProbeResult;
}[]>;
