import { installSkillFromLocalPath } from '../ai/skills/install.js';
import { getConfigDir } from '../utils/config.js';
export function registerSkillCommands(program) {
    const skill = program.command('skill').description('管理 xiaok skills');
    skill
        .command('install <source>')
        .description('安装本地 skill')
        .action(async (source) => {
        try {
            const result = await installSkillFromLocalPath(source, getConfigDir());
            console.log(`已安装 skill: ${result.name}`);
            console.log(`目标路径: ${result.destinationSkillPath}`);
            console.log('当前会话下一轮输入将自动可见该 skill');
        }
        catch (error) {
            console.error(String(error));
            process.exitCode = 1;
        }
    });
}
