#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { openSync, writeSync, closeSync, readFileSync } from 'node:fs';
import { createObserver } from './observer.mjs';
import { analyzeWindow } from './metrics.mjs';
import { evaluateExperiment } from './decision.mjs';
import { capturePrint } from './capture.mjs';

const help = `本地模型缓存测量（仅诊断，不自动优化）
  observe --upstream ORIGIN --out NEW.jsonl [--scope main] [--timeout-ms 900000]
  measure-print --upstream ORIGIN --model NAME --prompt-file FILE --out NEW.json
                [--cli-entry dist/index.js] [--cwd DIR] [--timeout-ms 180000]
  summarize --input FILE.jsonl
  decide --input EXPERIMENT.json

observe 逐块透传，监听随机 loopback 端口；--scope 仅在确认单一 owner 时填写。
measure-print 使用临时本地模型配置与真实 CLI；stdout flush 与 SSE 分别计时。
输入、工具名和 URL 仅记录临时 HMAC 摘要；不同进程的摘要不可拼接比较。
decide 仅计算 v5 的固定统计量，始终 inconclusive，不认证 ROI 或启用 production。
本工具不管理或重置模型缓存；不对共享服务卸载模型。使用 Ctrl-C 停止观察。
`;

let fd; let proxy;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries([
    ['help', { type: 'boolean' }], ...['upstream', 'out', 'scope', 'timeout-ms', 'model', 'prompt-file', 'cli-entry', 'cwd', 'input'].map(k => [k, { type: 'string' }]),
  ]) });
  if (values.help) { process.stdout.write(help); } else {
    if (positionals.length !== 1) throw new Error('invalid_command');
    const command = positionals[0];
    const allowed = { observe: ['upstream', 'out', 'scope', 'timeout-ms'], 'measure-print': ['upstream', 'model', 'prompt-file', 'out', 'cli-entry', 'cwd', 'timeout-ms'], summarize: ['input'], decide: ['input'] };
    if (!allowed[command] || Object.keys(values).some(k => !allowed[command].includes(k))) throw new Error('invalid_command');
    if (command === 'summarize' || command === 'decide') {
      if (!values.input) throw new Error('missing_input');
      const text = readFileSync(values.input, 'utf8');
      const result = command === 'decide' ? evaluateExperiment(JSON.parse(text)) : analyzeWindow(text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(r => r.request));
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      if (!values.upstream || !values.out) throw new Error('missing_input');
      try { fd = openSync(values.out, 'wx', 0o600); } catch (e) { throw new Error(e.code === 'EEXIST' ? 'output_exists' : 'output_open_failed'); }
      const write = record => { const bytes = Buffer.from(JSON.stringify(record) + '\n'); let offset = 0; while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset); };
      if (command === 'observe') {
        const totalMs = Number(values['timeout-ms'] ?? 900000);
        proxy = await createObserver({ upstream: values.upstream, scope: values.scope, timeouts: { totalMs }, onRecord: write });
        write({ version: 1, kind: 'window_start', keyId: proxy.keyId, totalLimitMs: totalMs, scopeKnown: Boolean(values.scope), startedAt: new Date().toISOString(), decision: 'inconclusive' });
        process.stdout.write(JSON.stringify({ listen: proxy.origin, keyId: proxy.keyId }) + '\n');
        await new Promise(resolve => {
          const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); resolve(); };
          process.on('SIGINT', stop); process.on('SIGTERM', stop); proxy.server.once('close', stop);
        });
        await proxy.close(); if (proxy.error) throw proxy.error;
        write({ version: 1, kind: 'window_end', keyId: proxy.keyId, complete: true });
      } else {
        if (!values.model || !values['prompt-file']) throw new Error('missing_input');
        const controller = new AbortController(); const cancel = () => controller.abort();
        process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
        try {
          const result = await capturePrint({ cliEntry: values['cli-entry'] ?? 'dist/index.js', cwd: values.cwd ?? process.cwd(), upstream: values.upstream,
            model: values.model, prompt: readFileSync(values['prompt-file'], 'utf8'), totalMs: Number(values['timeout-ms'] ?? 180000), signal: controller.signal });
          write(result); process.stdout.write(JSON.stringify({ status: result.status, visibleMs: result.visibleMs, totalMs: result.totalMs, decision: result.decision }) + '\n');
          if (result.status !== 'success') process.exitCode = 2;
        } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
      }
    }
  }
} catch (error) {
  // Do not echo parser values, private filenames, endpoint credentials, prompts or raw upstream errors.
  const code = ['output_exists', 'output_open_failed', 'invalid_command', 'missing_input', 'record_write_failed'].includes(error.message) ? error.message : 'invalid_input_or_runtime_failure';
  process.stderr.write(`cache_measurement_failed: ${code}\n`); process.exitCode = 1;
} finally { await proxy?.close(); if (fd !== undefined) closeSync(fd); }
