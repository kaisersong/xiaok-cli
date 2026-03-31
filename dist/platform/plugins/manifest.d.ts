export interface PluginManifestServer {
    name: string;
    command: string;
}
export interface PluginManifest {
    name: string;
    version: string;
    skills: string[];
    agents: string[];
    hooks: string[];
    commands: string[];
    mcpServers?: PluginManifestServer[];
    lspServers?: PluginManifestServer[];
}
export declare function parsePluginManifest(raw: Record<string, unknown>, pluginDir: string): PluginManifest;
