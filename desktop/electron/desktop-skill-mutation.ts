import crossSpawn from 'cross-spawn';
import { SKILL_MUTATION_NAME_SCHEMA, type DesktopSkillMutationContext, type DesktopSkillMutationResult } from '../shared/skill-mutation-ipc-contract.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { bumpSkillCatalogVersion } from './skill-catalog-invalidation.js';
// Main supplies cwd. No renderer-controlled roots, shell text, flags or source.
// Keep the existing synchronous command, deadlines and success/failure DTO.
export function runDesktopSkillMutation(operation: 'install' | 'uninstall', rawName: unknown,
  rawContext: DesktopSkillMutationContext, cwd: string): DesktopSkillMutationResult {
  const context = captureIpcData(rawContext, 'skill_mutation_source_forbidden');
  if (context?.requestSource !== 'user') throw Error('skill_mutation_source_forbidden');
  const input = captureIpcData(rawName, 'skill_mutation_input_invalid');
  if (!SKILL_MUTATION_NAME_SCHEMA.safeParse(input).success) throw Error('skill_mutation_input_invalid');
  const skillName = input as string;
  // cross-spawn handles Windows .cmd shims and argv escaping; no manual shell interpolation.
  const result = crossSpawn.sync('clawhub', [operation, skillName], {
    encoding: 'utf-8', timeout: operation === 'install' ? 60000 : 30000, cwd,
  });
  if (result.error) return { success: false, message: `执行失败: ${result.error.message}` };
  if (result.status !== 0) {
    const message = result.stderr?.trim() || result.stdout?.trim() || '未知错误';
    return { success: false, message: message.slice(0, 500) };
  }
  bumpSkillCatalogVersion();
  return { success: true, message: `技能 ${skillName} 已${operation === 'install' ? '安装' : '卸载'}` };
}
