import type { Command } from 'commander';
import { existsSync } from 'fs';
import { loadConfig, getConfigPath } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getCurrentBranch, isGitDirty } from '../utils/git.js';
import { listCandidateApiKeys } from '../ai/providers/auth-resolver.js';
import { probeApiKey, type KeyProbeResult } from '../ai/providers/key-probe.js';
import { listProviderProfiles } from '../ai/providers/registry.js';
import { resolveSystemOneConfig } from '../ai/providers/system-one-config.js';

export async function runDoctorCommand(cwd: string): Promise<string> {
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

const SOURCE_LABEL: Record<string, string> = {
  xiaok_env: 'XIAOK_* 环境变量',
  standard_env: '标准环境变量',
  config: '配置文件',
};

function describeProbeResult(result: KeyProbeResult): string {
  if (result.status === 'valid') return '✓ 可用';
  if (result.status === 'invalid') return '✗ 无效（鉴权失败）';
  if (result.status === 'network_error') return `? 无法确认（${result.detail ?? '网络错误'}）`;
  return '? 未知协议';
}

/**
 * 逐个 provider 扫描候选 API Key（XIAOK_ 前缀 / 标准环境变量 / 配置文件），
 * 对每个候选发起最小化只读请求验证是否真正可用。
 *
 * 会发出真实网络请求，仅在用户显式执行 `xiaok doctor --check-keys` 时触发，
 * 不会在其它命令路径中被静默调用。
 */
export async function runCheckKeysCommand(): Promise<string> {
  const config = await loadConfig();
  const lines: string[] = ['API Key 可用性检查', ''];

  let totalCandidates = 0;

  for (const profile of listProviderProfiles()) {
    const candidates = listCandidateApiKeys(config, profile.id);
    if (candidates.length === 0) continue;

    totalCandidates += candidates.length;
    lines.push(`Provider: ${profile.label} (${profile.id})`);

    for (const candidate of candidates) {
      const label = SOURCE_LABEL[candidate.source] ?? candidate.source;
      const varSuffix = candidate.envVarName ? ` [${candidate.envVarName}]` : '';
      const masked = maskApiKey(candidate.apiKey);
      const result = await probeApiKey(profile.protocol, profile.baseUrl, candidate.apiKey);

      lines.push(`  - ${label}${varSuffix} ${masked}: ${describeProbeResult(result)}`);
    }
    lines.push('');
  }

  // System One（Jev）是辅助决策模型，不在 registry 里，因此单独检查一次。
  const systemOne = resolveSystemOneConfig(config);
  if (systemOne.configured && systemOne.apiKey) {
    totalCandidates += 1;
    lines.push('System One（Jev，辅助决策模型）');
    const label = systemOne.keySource === 'config'
      ? SOURCE_LABEL.config
      : SOURCE_LABEL.standard_env;
    const varSuffix = systemOne.keyEnvVar ? ` [${systemOne.keyEnvVar}]` : '';
    const result = await probeApiKey('system_one', systemOne.baseUrl, systemOne.apiKey);
    lines.push(
      `  - ${label}${varSuffix} ${maskApiKey(systemOne.apiKey)}: ${describeProbeResult(result)}`,
    );
    lines.push('');
  }

  if (totalCandidates === 0) {
    lines.push('未发现任何候选 API Key（XIAOK_* 环境变量 / 标准环境变量 / 配置文件均为空）。');
  }

  return lines.join('\n').trimEnd();
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function registerDoctorCommands(program: Command): void {
  program
    .command('doctor')
    .description('检查本地 xiaok 工作台环境与配置')
    .option('--check-keys', '验证各 provider 候选 API Key 是否真正可用（会发起网络请求）')
    .action(async (opts: { checkKeys?: boolean }) => {
      if (opts.checkKeys) {
        console.log(await runCheckKeysCommand());
        return;
      }
      console.log(await runDoctorCommand(process.cwd()));
    });
}
