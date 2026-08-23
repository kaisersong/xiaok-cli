import { existsSync } from 'fs';
import { loadConfig, getConfigPath } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getCurrentBranch, isGitDirty } from '../utils/git.js';
import { listCandidateApiKeys } from '../ai/providers/auth-resolver.js';
import { probeApiKey } from '../ai/providers/key-probe.js';
import { listProviderProfiles } from '../ai/providers/registry.js';
export async function runDoctorCommand(cwd) {
    const config = await loadConfig();
    const credentials = await loadCredentials();
    const configPath = getConfigPath();
    const branch = await getCurrentBranch(cwd);
    const dirty = branch ? await isGitDirty(cwd) : false;
    return [
        'Doctor Report',
        '',
        'Config',
        `- path=${configPath}`,
        `- exists=${existsSync(configPath) ? 'yes' : 'no'}`,
        `- defaultProvider=${config.defaultProvider}`,
        `- defaultModelId=${config.defaultModelId}`,
        '',
        'Credentials',
        `- loggedIn=${credentials ? 'yes' : 'no'}`,
        `- enterpriseId=${credentials?.enterpriseId ?? '(none)'}`,
        '',
        'Git',
        `- repo=${branch ? 'yes' : 'no'}`,
        `- branch=${branch || '(none)'}`,
        `- dirty=${branch ? (dirty ? 'yes' : 'no') : '(n/a)'}`,
    ].join('\n');
}
const SOURCE_LABEL = {
    xiaok_env: 'XIAOK_* 环境变量',
    standard_env: '标准环境变量',
    config: '配置文件',
};
/**
 * 逐个 provider 扫描候选 API Key（XIAOK_ 前缀 / 标准环境变量 / 配置文件），
 * 对每个候选发起最小化只读请求验证是否真正可用。
 *
 * 会发出真实网络请求，仅在用户显式执行 `xiaok doctor --check-keys` 时触发，
 * 不会在其它命令路径中被静默调用。
 */
export async function runCheckKeysCommand() {
    const config = await loadConfig();
    const lines = ['API Key 可用性检查', ''];
    let totalCandidates = 0;
    for (const profile of listProviderProfiles()) {
        const candidates = listCandidateApiKeys(config, profile.id);
        if (candidates.length === 0)
            continue;
        totalCandidates += candidates.length;
        lines.push(`Provider: ${profile.label} (${profile.id})`);
        for (const candidate of candidates) {
            const label = SOURCE_LABEL[candidate.source] ?? candidate.source;
            const varSuffix = candidate.envVarName ? ` [${candidate.envVarName}]` : '';
            const masked = maskApiKey(candidate.apiKey);
            const result = await probeApiKey(profile.protocol, profile.baseUrl, candidate.apiKey);
            const statusLabel = result.status === 'valid'
                ? '✓ 可用'
                : result.status === 'invalid'
                    ? '✗ 无效（鉴权失败）'
                    : result.status === 'network_error'
                        ? `? 无法确认（${result.detail ?? '网络错误'}）`
                        : '? 未知协议';
            lines.push(`  - ${label}${varSuffix} ${masked}: ${statusLabel}`);
        }
        lines.push('');
    }
    if (totalCandidates === 0) {
        lines.push('未发现任何候选 API Key（XIAOK_* 环境变量 / 标准环境变量 / 配置文件均为空）。');
    }
    return lines.join('\n').trimEnd();
}
function maskApiKey(key) {
    if (key.length <= 8)
        return '****';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
export function registerDoctorCommands(program) {
    program
        .command('doctor')
        .description('检查本地 xiaok 工作台环境与配置')
        .option('--check-keys', '验证各 provider 候选 API Key 是否真正可用（会发起网络请求）')
        .action(async (opts) => {
        if (opts.checkKeys) {
            console.log(await runCheckKeysCommand());
            return;
        }
        console.log(await runDoctorCommand(process.cwd()));
    });
}
