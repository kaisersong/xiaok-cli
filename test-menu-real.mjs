#!/usr/bin/env node
import { spawn } from 'child_process';

console.log('测试 1: 启动 xiaok，输入 /，检查菜单是否显示\n');

const proc = spawn('node', ['dist/index.js', 'chat'], {
  cwd: '/Users/song/projects/xiaok-cli',
  env: { ...process.env, FORCE_COLOR: '0' }
});

let output = '';

proc.stdout.on('data', (data) => {
  output += data.toString();
  process.stdout.write(data);
});

proc.stderr.on('data', (data) => {
  process.stderr.write(data);
});

// 等待启动
setTimeout(() => {
  console.log('\n发送 / 字符...\n');
  proc.stdin.write('/');

  // 等待菜单显示
  setTimeout(() => {
    console.log('\n\n=== 输出内容 ===');
    console.log(output);
    console.log('=== 输出结束 ===\n');

    // 检查是否有菜单
    if (output.includes('/exit') || output.includes('/help') || output.includes('/clear')) {
      console.log('✓ 菜单显示正常');
    } else {
      console.log('✗ 菜单未显示');
    }

    proc.stdin.write('\x03'); // Ctrl+C
    proc.kill();
  }, 1000);
}, 2000);
