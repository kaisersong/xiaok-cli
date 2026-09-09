// Run with native Windows Node; imports the installed/built production entry points.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
if (process.platform !== 'win32') throw new Error('Native Windows is required');
const root = path.resolve(process.argv[2] ?? '.');
const { bashTool } = await import(pathToFileURL(path.join(root, 'dist/ai/tools/bash.js')));
const { runInteractiveShellCommand } = await import(pathToFileURL(path.join(root, 'dist/commands/chat-shell-escape.js')));
const dir = await mkdtemp(path.join(tmpdir(), 'xiaok shell quotes '));
let failures = 0;
try {
  await writeFile(path.join(dir, 'input data.txt'), 'alpha beta\r\ngamma delta\r\n');
  await copyFile(process.execPath, path.join(dir, 'node probe.exe'));
  const cases = [
    ['powershell expression', 'powershell -NoProfile -Command "Write-Output (6*7)"', /^42$/],
    ['findstr multiple patterns', 'findstr /L /C:"alpha beta" /C:"gamma delta" "input data.txt"', /alpha beta[\s\S]*gamma delta/],
    ['pipe', 'type "input data.txt" | findstr /L /C:"gamma delta"', /^gamma delta$/],
    ['quoted executable', '"' + path.join(dir, 'node probe.exe') + '" -p "6*7"', /^42$/],
    ['redirect and chain', 'echo hello>"output file.txt" && type "output file.txt"', /^hello$/],
  ];
  for (const entry of ['tool', 'interactive']) {
    for (const [name, command, expected] of cases) {
      try {
        const result = entry === 'tool'
          ? await bashTool.execute({ command, workdir: dir })
          : await runInteractiveShellCommand(command, { cwd: dir });
        const output = typeof result === 'string' ? result : result.output;
        assert.match(output.trim(), expected);
        if (typeof result !== 'string') assert.equal(result.exitCode, 0);
        console.log(`PASS ${entry} ${name}`);
      } catch (error) { failures++; console.error(`FAIL ${entry} ${name}: ${error.message}`); }
    }
  }
} finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }); }
assert.equal(failures, 0, `${failures} native Windows shell regressions`);
