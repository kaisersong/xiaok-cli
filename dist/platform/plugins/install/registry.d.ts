export declare const DEFAULT_REGISTRY_V2_URL = "https://raw.githubusercontent.com/kaisersong/kai-xiaok-plugins/main/registry-v2.json";
export declare const REGISTRY_MAX_BYTES: number;
export type TrustedInstallStepKind = 'npm_ci' | 'npm_run' | 'python_requirements' | 'external';
export interface TrustedInstallStep {
    kind: TrustedInstallStepKind;
    /** POSIX relative directory inside the plugin root. */
    cwd: string;
    /** npm_run only. */
    script?: string;
    /** python_requirements only. */
    file?: string;
    /** external only: MCP servers that stay unprobed because the step is manual. */
    serverNames?: string[];
    reason?: string;
}
export interface TrustedPluginRepository {
    owner: string;
    name: string;
    cloneUrl: string;
}
export interface TrustedRegistryPlugin {
    name: string;
    displayName: string;
    description: string;
    keywords: string[];
    repo: TrustedPluginRepository;
    path: string;
    version: string;
    source: {
        commit: string;
        treeSha256: string;
    };
    install: {
        steps: TrustedInstallStep[];
    };
    runtime?: string;
}
export interface TrustedRegistry {
    version: 2;
    plugins: TrustedRegistryPlugin[];
}
export declare function normalizePluginRepository(repo: unknown): TrustedPluginRepository;
export declare function parseTrustedRegistry(raw: unknown): TrustedRegistry;
export interface RegistryHttpResponse {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
    url: string;
}
export type RegistryRequest = (url: string, maxBytes: number) => Promise<RegistryHttpResponse>;
export interface FetchTrustedRegistryOptions {
    registryUrl?: string;
    trustRegistry?: boolean;
    request?: RegistryRequest;
    maxBytes?: number;
    maxRedirects?: number;
}
export declare function fetchTrustedRegistryDocument(options?: FetchTrustedRegistryOptions): Promise<TrustedRegistry>;
