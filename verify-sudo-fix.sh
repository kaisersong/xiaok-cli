#!/bin/bash
# xiaok-cli sudo freeze bug - 快速验证脚本

set -e

echo "=== 验证 sudo block 拦截 ==="

cd "$(dirname "$0")"

echo "1. 构建..."
npm run build > /dev/null 2>&1

echo "2. 测试 bash-safety 拦截..."
node -e "
const { classifyBashCommand } = require('./dist/ai/tools/bash-safety.js');

const tests = [
  ['sudo ls /root', 'block'],
  ['sudo killall -9 clash', 'block'],
  ['killall clash', 'warn'],
  ['ls', 'safe']
];

let passed = 0;
let failed = 0;

for (const [cmd, expected] of tests) {
  const result = classifyBashCommand(cmd);
  if (result.level === expected) {
    console.log('✓', cmd, '→', result.level);
    passed++;
  } else {
    console.log('✗', cmd, '→', result.level, '(expected:', expected + ')');
    failed++;
  }
}

console.log('');
console.log('Passed:', passed);
console.log('Failed:', failed);

if (failed > 0) {
  process.exit(1);
}
"

echo ""
echo "=== E2E 测试指南 ==="
echo "启动 xiaok chat 并发送："
echo "  '杀掉 clash-verge-service 进程'"
echo ""
echo "期望结果："
echo "  ✓ AI 使用 '! sudo killall...' 格式（文本输出）"
echo "  ✓ 不调用 Bash 工具"
echo "  ✓ 不触发 macOS 密码 icon"
echo "  ✓ 输入栏正常工作"
echo ""
echo "如果出现密码 icon 或界面冻结，说明修复未生效。"