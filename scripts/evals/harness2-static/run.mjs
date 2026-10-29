#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildStaticReport } from './preflight.mjs';

let phase = 'arguments';
try {
  const { values, positionals } = parseArgs({ options: { output: { type: 'string' }, help: { type: 'boolean' } } });
  if (positionals.length || (values.help && values.output)) throw new Error('invalid_arguments');
  if (values.help) {
    process.stdout.write('Harness² v46 P0a 静态检查（零模型调用）\n'
      + 'npm run eval:harness2:static -- [--output NEW.json]\n'
      + '验证固定指标支配关系并盘点源码；成功的 stop_paid_reflect 返回 0。\n'
      + 'D0 前置真实材料缺失时保持 not_started；不授权研究或启用产品。\n');
  } else {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    phase = 'source_inventory';
    const report = await buildStaticReport(root);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (values.output !== undefined) {
      phase = 'output_write';
      writeFileSync(values.output, json, { flag: 'wx', mode: 0o600 });
      process.stdout.write('P0a: stop_paid_reflect; D0: not_started; 已写入静态检查报告。\n');
    } else process.stdout.write(json);
  }
} catch (error) {
  const code = error.code === 'EEXIST' ? 'output_exists'
    : phase === 'arguments' ? 'invalid_arguments'
    : phase === 'output_write' ? 'output_write_failed' : 'source_inventory_failed';
  process.stderr.write(`harness2_static_failed: ${code}\n`);
  process.exitCode = 1;
}
