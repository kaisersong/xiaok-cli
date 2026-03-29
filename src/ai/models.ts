import type { ModelAdapter } from '../types.js';
import type { Config } from '../types.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { OpenAIAdapter } from './adapters/openai.js';

export function createAdapter(config: Config): ModelAdapter {
  const provider = config.defaultModel;
  // 按提供商读取 API Key：环境变量优先于配置文件
  // 注意：不支持无前缀的 XIAOK_API_KEY
  const envKey = process.env[`XIAOK_${provider.toUpperCase()}_API_KEY`];
  const configKey = provider === 'claude' ? config.models.claude?.apiKey
    : provider === 'openai' ? config.models.openai?.apiKey
    : config.models.custom?.apiKey;
  const providerKey = envKey ?? configKey;

  if (!providerKey && provider !== 'custom') {
    throw new Error(
      `未配置 API Key。请运行: xiaok config set api-key <key> --provider ${provider}\n` +
      `或设置环境变量 XIAOK_${provider.toUpperCase()}_API_KEY`
    );
  }

  if (provider === 'claude') {
    const m = config.models.claude;
    return new ClaudeAdapter(providerKey!, m?.model ?? 'claude-opus-4-6');
  }

  if (provider === 'openai') {
    const m = config.models.openai;
    return new OpenAIAdapter(providerKey!, m?.model ?? 'gpt-4o');
  }

  if (provider === 'custom') {
    const m = config.models.custom;
    if (!m?.baseUrl) throw new Error('custom 模型需要配置 baseUrl。请运行: xiaok config set model custom --base-url <url>');
    const apiKey = process.env.XIAOK_CUSTOM_API_KEY ?? m.apiKey ?? '';
    // 自定义端点的 model 名称从配置中读取，未配置时使用 'default'（部分 provider 忽略此字段）
    return new OpenAIAdapter(apiKey, 'default', m.baseUrl);
  }

  throw new Error(`未知的模型提供商: ${provider}`);
}
