#!/usr/bin/env node
import { InputReader } from './dist/ui/input.js';

const reader = new InputReader();

console.log('测试空输入不换行（按回车但不输入内容）');
console.log('输入 "exit" 退出\n');

while (true) {
  const input = await reader.read('\x1b[1;36m> \x1b[0m');

  if (input === null) {
    console.log('\n已取消');
    break;
  }

  const trimmed = input.trim();
  if (!trimmed) continue;

  if (trimmed === 'exit') {
    console.log('再见！');
    break;
  }

  console.log(`你输入了: ${trimmed}`);
}
