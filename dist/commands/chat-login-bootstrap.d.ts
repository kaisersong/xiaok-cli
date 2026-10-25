import type { Config, ModelAdapter } from '../types.js';
import { type LoginCommandResult, type LoginOptions, type LoginCancellation } from './login.js';
export interface ChatLoginBootstrapOptions {
    interactive: boolean;
    hasInitialInput: boolean;
    cancellation?: LoginCancellation;
}
export interface ChatLoginBootstrapDependencies {
    createAdapter(config: Config): ModelAdapter;
    runLogin(options: LoginOptions, cancellation?: LoginCancellation): Promise<LoginCommandResult>;
    loadConfig(): Promise<Config>;
    writeLine(text: string): void;
}
/**
 * Connect the default interactive chat entry to the existing `xiaok login`
 * flow. Scripted and single-shot invocations must keep failing fast rather
 * than waiting for terminal input.
 */
export declare function createChatAdapterWithLoginBootstrap(config: Config, options: ChatLoginBootstrapOptions, dependencies?: ChatLoginBootstrapDependencies): Promise<{
    config: Config;
    adapter: ModelAdapter;
}>;
