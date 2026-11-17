import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [name, ...options] = process.argv.slice(2);
if (!['desktop-path-tests', 'desktop-history-tests'].includes(name)) throw Error('unknown_desktop_test_list');
const tests = readFileSync(new URL(`../ci/${name}.txt`, import.meta.url), 'utf8').trim().split(/\r?\n/);
if (!tests.length || tests.some(test => !/^tests\/[\w./-]+\.test\.tsx?$/.test(test))) throw Error('invalid_desktop_test_list');
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...options, ...tests], { stdio: 'inherit', shell: false });
if (result.error) throw result.error;
process.exitCode = result.signal ? 1 : result.status ?? 1;
