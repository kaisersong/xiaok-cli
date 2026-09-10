export interface InstallSkillResult {
    name: string;
    destinationDir: string;
    destinationSkillPath: string;
}
export declare function installSkillFromLocalPath(source: string, configDir: string): Promise<InstallSkillResult>;
