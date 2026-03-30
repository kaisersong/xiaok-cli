import type { PermissionSettings } from '../../types.js';
declare function getGlobalSettingsPath(): string;
declare function getProjectSettingsPath(cwd: string): string;
/** 加载全局 + 项目级 settings */
export declare function loadSettings(cwd: string): Promise<{
    global: PermissionSettings;
    project: PermissionSettings;
}>;
/** 合并两层 settings 的 allow/deny 规则 */
export declare function mergeRules(settings: {
    global: PermissionSettings;
    project: PermissionSettings;
}): {
    allowRules: string[];
    denyRules: string[];
};
/** 向指定层级添加一条 allow 规则（去重） */
export declare function addAllowRule(scope: 'global' | 'project', rule: string, cwd: string): Promise<void>;
/** 向指定层级添加一条 deny 规则（去重） */
export declare function addDenyRule(scope: 'global' | 'project', rule: string, cwd: string): Promise<void>;
export { getGlobalSettingsPath, getProjectSettingsPath };
