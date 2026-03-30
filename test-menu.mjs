import { InputReader } from './dist/ui/input.js';

const reader = new InputReader();
reader.setSkills([
  { name: 'test-skill', description: 'Test skill', path: '.xiaok/skills/test-skill.md' }
]);

console.log('请输入 / 测试菜单...');
const result = await reader.read('> ');
console.log('\n你输入了:', result);
