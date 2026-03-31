export interface SkillMeta {
    name: string;
    description: string;
    content: string;
    path: string;
    source: 'builtin' | 'global' | 'project';
    tier: 'system' | 'user' | 'project';
}
export interface SkillLoadOptions {
    builtinRoots?: string[];
    extraRoots?: string[];
}
export interface SkillCatalog {
    reload(): Promise<SkillMeta[]>;
    list(): SkillMeta[];
    get(name: string): SkillMeta | undefined;
}
/**
 * 加载所有可用 skills。项目本地优先于全局（同名时覆盖）。
 *
 * @param xiaokConfigDir  ~/.xiaok 目录路径（测试时可覆盖）
 * @param cwd             当前工作目录（用于查找 .xiaok/skills/）
 */
export declare function loadSkills(xiaokConfigDir?: string, cwd?: string, options?: SkillLoadOptions): Promise<SkillMeta[]>;
export declare function createSkillCatalog(xiaokConfigDir?: string, cwd?: string, options?: SkillLoadOptions): SkillCatalog;
/** 格式化 skills 列表为系统提示片段 */
export declare function formatSkillsContext(skills: SkillMeta[]): string;
/** 解析用户输入中的斜杠命令。以 / 开头且第一个 token 是 skill 名称。 */
export declare function parseSlashCommand(input: string): {
    skillName: string;
    rest: string;
} | null;
