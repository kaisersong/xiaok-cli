import { createAdapter as createProductionAdapter } from '../ai/models.js';
import { MissingProviderApiKeyError } from '../ai/providers/control-plane.js';
import { loadConfig as loadProductionConfig } from '../utils/config.js';
import { writeLine as writeProductionLine } from '../utils/ui.js';
import { runLoginCommand as runProductionLogin, } from './login.js';
const productionDependencies = {
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
export async function createChatAdapterWithLoginBootstrap(config, options, dependencies = productionDependencies) {
    try {
        return { config, adapter: dependencies.createAdapter(config) };
    }
    catch (error) {
        if (!(error instanceof MissingProviderApiKeyError)
            || !options.interactive
            || options.hasInitialInput) {
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
