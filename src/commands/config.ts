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

  configSet
    .command('yzj-webhook-url <url>')
    .description('设置云之家 webhookUrl')
    .action(async (url: string) => {
      const cfg = await loadConfig();
      cfg.channels = cfg.channels ?? {};
      cfg.channels.yzj = {
        ...(cfg.channels.yzj ?? {}),
        webhookUrl: url,
      };
      await saveConfig(cfg);
      console.log('已设置 channels.yzj.webhookUrl');
    });

  configSet
    .command('yzj-inbound-mode <mode>')
    .description('设置云之家入站模式（webhook / websocket）')
    .action(async (mode: string) => {
      if (mode !== 'webhook' && mode !== 'websocket') {
        console.error('inbound-mode 仅支持 webhook 或 websocket');
        return;
      }
      const cfg = await loadConfig();
      cfg.channels = cfg.channels ?? {};
      cfg.channels.yzj = {
        ...(cfg.channels.yzj ?? {}),
        inboundMode: mode,
      };
      await saveConfig(cfg);
      console.log(`已设置 channels.yzj.inboundMode = ${mode}`);
    });

  configSet
    .command('yzj-webhook-path <path>')
    .description('设置云之家 webhook 路径')
    .action(async (path: string) => {
      const cfg = await loadConfig();
      cfg.channels = cfg.channels ?? {};
      cfg.channels.yzj = {
        ...(cfg.channels.yzj ?? {}),
        webhookPath: path,
      };
      await saveConfig(cfg);
      console.log(`已设置 channels.yzj.webhookPath = ${path}`);
    });

  configSet
    .command('yzj-webhook-port <port>')
    .description('设置云之家 webhook 监听端口')
    .action(async (port: string) => {
      const parsed = Number(port);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        console.error('webhook-port 必须是正整数');
        return;
      }
      const cfg = await loadConfig();
      cfg.channels = cfg.channels ?? {};
      cfg.channels.yzj = {
        ...(cfg.channels.yzj ?? {}),
        webhookPort: parsed,
      };
      await saveConfig(cfg);
      console.log(`已设置 channels.yzj.webhookPort = ${parsed}`);
    });

  configSet
    .command('yzj-secret <secret>')
    .description('设置云之家 webhook 签名 secret')
    .action(async (secret: string) => {
      const cfg = await loadConfig();
      cfg.channels = cfg.channels ?? {};
      cfg.channels.yzj = {
        ...(cfg.channels.yzj ?? {}),
        secret,
      };
      await saveConfig(cfg);
      console.log('已设置 channels.yzj.secret');
    });

  config
    .command('get <key>')
    .description('获取配置项（如 model）')
    .action(async (key: string) => {
      const cfg = await loadConfig();
      if (key === 'model') {
        const m = cfg.models[cfg.defaultModel];
        console.log(`${cfg.defaultModel}${'model' in (m ?? {}) ? '/' + (m as { model: string }).model : ''}`);
      } else if (key === 'yzj') {
        console.log(JSON.stringify(cfg.channels?.yzj ?? null, null, 2));
      } else if (key === 'yzj.webhook-url') {
        console.log(cfg.channels?.yzj?.webhookUrl ?? '');
      } else if (key === 'yzj.inbound-mode') {
        console.log(cfg.channels?.yzj?.inboundMode ?? '');
      } else if (key === 'yzj.webhook-path') {
        console.log(cfg.channels?.yzj?.webhookPath ?? '');
      } else if (key === 'yzj.webhook-port') {
        console.log(cfg.channels?.yzj?.webhookPort ?? '');
      } else {
        console.log(JSON.stringify((cfg as unknown as Record<string, unknown>)[key] ?? null, null, 2));
      }
    });
}
