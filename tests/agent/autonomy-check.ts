/** Check the built CLI prompt, not live-model adherence. Run npm run test:autonomy:check. */
import { PromptBuilder } from '../../dist/ai/prompts/builder.js';

const snapshot = await new PromptBuilder({
  memoryStore: { listRelevant: async () => [] }, harnessMemoryStore: { listActive: () => [] },
}).build({ cwd: process.cwd(), channel: 'chat', enterpriseId: null, devApp: null,
  budget: 4000, autoContext: { docs: [], git: null }, cliDelegation: { interactive: false },
});
const checks: Array<[string, boolean]> = [
  ['执行已授权任务', snapshot.rendered.includes('instructions to execute') && snapshot.rendered.includes('authorized scope')],
  ['交互命令边界', snapshot.rendered.includes('genuine interactive input')],
  ['不重复确认', snapshot.rendered.includes('Do not ask again')],
  ['验证实际结果', snapshot.rendered.includes('Verify before claiming success')],
  ['保留用户拒绝分派', snapshot.rendered.includes('do not switch to another delegation tool')],
  ['无交互时不调用提问工具', snapshot.rendered.includes('Do not call AskUserQuestion or ask_user')],
  ['通用层不超过 9000 字符', snapshot.segments.find(s => s.key === 'static_identity')!.text.length <= 9000],
];
for (const [label, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
process.exitCode = checks.every(([, passed]) => passed) ? 0 : 1;
