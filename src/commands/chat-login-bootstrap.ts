import type { Config, ModelAdapter } from '../types.js';
import { createAdapter as createProductionAdapter } from '../ai/models.js';
import { MissingProviderApiKeyError } from '../ai/providers/control-plane.js';
import { loadConfig as loadProductionConfig } from '../utils/config.js';
import { writeLine as writeProductionLine } from '../utils/ui.js';
import {
  runLoginCommand as runProductionLogin,
  type LoginCommandResult,
  type LoginOptions,
} from './login.js';

export interface ChatLoginBootstrapOptions {
  interactive: boolean;
  hasInitialInput: boolean;
}

export interface ChatLoginBootstrapDependencies {
  createAdapter(config: Config): ModelAdapter;
  runLogin(options: LoginOptions): Promise<LoginCommandResult>;
  loadConfig(): Promise<Config>;
  writeLine(text: string): void;
}

const productionDependencies: ChatLoginBootstrapDependencies = {
  createAdapter: createProductionAdapter,
  runLogin: runProductionLogin,
  loadConfig: loadProductionConfig,
  writeLine: writeProductionLine,
};

/**
 * Connect the default interactive chat entry to the existing `xiaok login`
 * flow. Scripted and single-shot invocations must keep failing fast rather
 * than waiting for terminal input.
 */
export async function createChatAdapterWithLoginBootstrap(
  config: Config,
  options: ChatLoginBootstrapOptions,
  dependencies: ChatLoginBootstrapDependencies = productionDependencies,
): Promise<{ config: Config; adapter: ModelAdapter }> {
  try {
    return { config, adapter: dependencies.createAdapter(config) };
  } catch (error) {
    if (
      !(error instanceof MissingProviderApiKeyError)
      || !options.interactive
      || options.hasInitialInput
    ) {
      throw error;
    }

    dependencies.writeLine('首次使用需要先登录并配置 AI provider。现在进入登录向导；按 Ctrl+C 可退出。');
    const result = await dependencies.runLogin({ setDefault: true });
    if (result.status !== 'saved') {
      throw error;
    }

    const configured = await dependencies.loadConfig();
    return {
      config: configured,
      adapter: dependencies.createAdapter(configured),
    };
  }
}
