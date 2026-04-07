import { createInstallSkillTool } from './dist/ai/tools/install-skill.js';

async function main() {
  const tool = createInstallSkillTool({ cwd: process.cwd() });

  console.log('测试: 安装 garrytan/gstack 仓库\n');

  const result = await tool.execute({ source: 'garrytan/gstack', scope: 'global' });
  console.log('Result:\n', result);
}

main().catch(console.error);