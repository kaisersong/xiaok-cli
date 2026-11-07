import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const mode of [
  'api',
  'claim',
  'commit',
  'released',
  'legacy',
  'rollback-1',
  'rollback-2',
  'rollback-3',
  'rollback-4',
  'gang',
  'corrupt-hash-blob',
  'corrupt-hash-nul',
  'corrupt-receipt-blob',
  'corrupt-receipt-nul',
  ...Array.from({ length: 6 }, (_, i) => 'vm-rollback-' + (i + 1)),
]) {
  test(
    'actual same Root transaction preserves process intent: ' + mode,
    { skip: process.platform !== 'darwin', timeout: 30000 },
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'xiaok-process-intent-'));
      const domain = join(root, 'domain');
      mkdirSync(domain);
      if (mode === 'legacy')
        copyFileSync(
          join(repo, 'tests/native/fixtures/process-intent-v4.sqlite'),
          join(domain, 'root-resource-v1.sqlite'),
        );
      const finite = join(root, 'finite.h');
      writeFileSync(
        finite,
        'static const char *nr_fixture_metadata[]={NULL};\nstatic const char *nr_fixture_execution_keys[]={NULL};\nstatic const int nr_fixture_priorities[]={0};\n#define NR_FIXTURE_FACT_COUNT 0\n',
      );
      const addon = join(root, 'main.node');
      const built = spawnSync(
        process.execPath,
        [
          join(repo, 'native/root-resource-authority/build-main-session.mjs'),
          process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,
          addon,
          domain,
          'embedded',
          finite,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(built.status, 0, built.stderr || built.stdout);
      const electron = await getNativeTestElectronExecutable(repo);
      const result = join(root, 'facts.json'),
        env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.ELECTRON_RUN_AS_NODE;
      const args = [
        join(repo, 'tests/native/fixtures/process-launch-intent.cjs'),
        addon,
        domain,
        result,
        join(root, 'userData'),
        mode,
      ];
      const child = spawn(electron, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const row = { pid: child.pid, args, stdout: '', stderr: '', signals: [] };
      child.stdout.on('data', (value) => {
        row.stdout += value;
      });
      child.stderr.on('data', (value) => {
        row.stderr += value;
      });
      const watchdog = setTimeout(() => {
        if (child.exitCode === null) {
          row.signals.push('SIGTERM');
          child.kill('SIGTERM');
        }
      }, 20000);
      await new Promise((yes, no) => {
        child.once('error', no);
        child.once('close', (code, signal) => {
          Object.assign(row, { code, signal, reaped: true });
          yes();
        });
      });
      clearTimeout(watchdog);
      writeFileSync(join(root, 'run.json'), JSON.stringify(row, null, 2));
      console.log(JSON.stringify({ root, ...row }));
      assert.equal(row.code, 0, row.stderr);
      assert.deepEqual(row.signals, []);
      const facts = JSON.parse(readFileSync(result, 'utf8'));
      assert.equal(facts.ok, true, JSON.stringify(facts));
      if (
        mode === 'claim' ||
        mode === 'commit' ||
        mode === 'released' ||
        mode.startsWith('corrupt-')
      ) {
        const coldArgs = [...args];
        coldArgs[coldArgs.length - 1] = mode.startsWith('corrupt-')
          ? 'cold-corrupt'
          : 'cold';
        const cold = spawn(electron, coldArgs, {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const coldRow = {
          pid: cold.pid,
          args: coldArgs,
          stderr: '',
          signals: [],
        };
        cold.stderr.on('data', (value) => {
          coldRow.stderr += value;
        });
        const coldTimer = setTimeout(() => {
          if (cold.exitCode === null) {
            coldRow.signals.push('SIGTERM');
            cold.kill('SIGTERM');
          }
        }, 20000);
        await new Promise((yes, no) => {
          cold.once('error', no);
          cold.once('close', (code, signal) => {
            Object.assign(coldRow, { code, signal, reaped: true });
            yes();
          });
        });
        clearTimeout(coldTimer);
        writeFileSync(
          join(root, 'cold-run.json'),
          JSON.stringify(coldRow, null, 2),
        );
        console.log(JSON.stringify({ root, cold: coldRow }));
        assert.equal(coldRow.code, 0, coldRow.stderr);
        assert.deepEqual(coldRow.signals, []);
        assert.equal(
          JSON.parse(readFileSync(result, 'utf8'))[
            mode.startsWith('corrupt-')
              ? 'corruptHistoryRefused'
              : 'noColdGrant'
          ],
          true,
        );
      }
    },
  );
}
