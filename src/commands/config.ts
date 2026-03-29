import type { Command } from 'commander';
import { loadConfig, saveConfig } from '../utils/config.js';

export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('管理 xiaok 配置');

  const configSet = config.command('set').description('设置配置项');

  configSet
    .command('model <value>')
    .description('设置默认 AI 模型（claude / openai / custom）')
    .option('--base-url <url>', '自定义模型 base URL（model=custom 时使用）')
    .option('--api-key <key>', '同时设置该模型的 API Key')
    .action(async (value: string, opts: { baseUrl?: string; apiKey?: string }) => {
      const cfg = await loadConfig();
      if (value === 'claude' || value === 'openai' || value === 'custom') {
        cfg.defaultModel = value;
        if (opts.baseUrl && value === 'custom') {
          cfg.models.custom = { ...cfg.models.custom, baseUrl: opts.baseUrl };
        }
        if (opts.apiKey) {
          cfg.models[value] = { ...cfg.models[value], apiKey: opts.apiKey } as never;
        }
        await saveConfig(cfg);
        console.log(`已设置默认模型为: ${value}`);
      } else {
        // 尝试解析为 provider/model 格式，如 openai/gpt-4o
        const [provider, model] = value.split('/');
        if (provider && model && ['claude', 'openai'].includes(provider)) {
          cfg.defaultModel = provider as 'claude' | 'openai';
          cfg.models[provider as 'claude' | 'openai'] = {
            ...cfg.models[provider as 'claude' | 'openai'],
            model,
          };
          await saveConfig(cfg);
          console.log(`已设置默认模型为: ${provider}/${model}`);
        } else {
          console.error(`未知模型: ${value}。支持: claude, openai, custom, openai/gpt-4o 等`);
        }
      }
    });

  configSet
    .command('api-key <key>')
    .description('设置 AI 模型 API Key')
    .option('--provider <provider>', '指定提供商（默认当前默认模型）')
    .action(async (key: string, opts: { provider?: string }) => {
      const cfg = await loadConfig();
      const provider = (opts.provider ?? cfg.defaultModel) as 'claude' | 'openai' | 'custom';
      // custom 模型必须先有 baseUrl 才能设置 apiKey
      if (provider === 'custom' && !cfg.models.custom?.baseUrl) {
        console.error('请先设置 baseUrl：xiaok config set model custom --base-url <url>');
        return;
      }
      cfg.models[provider] = { ...cfg.models[provider], apiKey: key } as never;
      await saveConfig(cfg);
      console.log(`已为 ${provider} 设置 API Key`);
    });

  configSet
    .command('context-budget <tokens>')
    .description('设置系统提示 token 预算（默认 4000）')
    .action(async (tokens: string) => {
      const cfg = await loadConfig();
      cfg.contextBudget = parseInt(tokens, 10);
      await saveConfig(cfg);
      console.log(`已设置 context-budget 为 ${tokens} tokens`);
    });

  config
    .command('get <key>')
    .description('获取配置项（如 model）')
    .action(async (key: string) => {
      const cfg = await loadConfig();
      if (key === 'model') {
        const m = cfg.models[cfg.defaultModel];
        console.log(`${cfg.defaultModel}${'model' in (m ?? {}) ? '/' + (m as { model: string }).model : ''}`);
      } else {
        console.log(JSON.stringify((cfg as unknown as Record<string, unknown>)[key] ?? null, null, 2));
      }
    });
}
