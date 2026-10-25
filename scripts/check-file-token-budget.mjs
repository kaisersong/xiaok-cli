import { execFileSync } from 'node:child_process';
import { readFileSync, writeSync } from 'node:fs';
import path from 'node:path';

// Root-relative globs; **/ also matches zero directory levels.
const IGNORE_GLOBS = [
  '**/package-lock.json', '**/npm-shrinkwrap.json', '**/pnpm-lock.yaml',
  '**/yarn.lock', '**/bun.lockb', '**/bun.lock', '**/Cargo.lock',
  '**/Pipfile.lock', '**/poetry.lock', '**/uv.lock', '**/composer.lock',
  '**/Gemfile.lock', '**/go.sum',
  '**/dist/**', '**/build/**', '**/out/**', '**/coverage/**',
  '**/*.min.js', '**/*.map', '**/*.generated.*', '**/*.d.ts',
  '**/snapshots/**', '**/__snapshots__/**', '**/*.snap',
  '**/artifacts/**', '**/test-results/**',
];
const MAX_TOKENS = 5000;
const MAX_BYTES = MAX_TOKENS * 4;

// Support *, **, ?, and character classes without external dependencies.
function compileGlob(glob) {
  glob = glob.replace(/^\.\//, '').replace(/^\//, '');
  if (glob.endsWith('/')) glob += '**';
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          source += '(?:.*/)?';
          i++;
        } else source += '.*';
      } else source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else if (char === '[' && glob.indexOf(']', i + 1) > i + 1) {
      const end = glob.indexOf(']', i + 1);
      let contents = glob.slice(i + 1, end);
      if (contents.startsWith('!')) contents = '^' + contents.slice(1);
      source += '[' + contents.replace(/\\/g, '\\\\') + ']';
      i = end;
    } else source += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp('^' + source + '$', 'u');
}

function main() {
  const git = (...args) => execFileSync('git', args, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const root = git('rev-parse', '--show-toplevel').trimEnd();
  process.chdir(root);
  const files = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')
    .split('\0').filter(Boolean);
  if (files.length === 0) return;
  let custom = [];
  try {
    custom = readFileSync(path.join(root, '.token-budget-ignore'), 'utf8')
      .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const ignores = [...IGNORE_GLOBS, ...custom].map(compileGlob);
  // Disable rename formatting so every NUL record has exactly one path.
  const binaries = new Set();
  for (const record of git('diff', '--cached', '--numstat', '--no-renames', '--no-ext-diff', '--no-textconv', '-z').split('\0')) {
    if (record.startsWith('-\t-\t')) binaries.add(record.slice(4));
  }
  const violations = [];
  for (const file of files) {
    if (binaries.has(file) || ignores.some(pattern => pattern.test(file))) continue;
    const bytes = Number(git('cat-file', '-s', `:${file}`).trim());
    if (!Number.isSafeInteger(bytes)) throw new Error(`无法读取暂存文件大小：${file}`);
    if (bytes > MAX_BYTES) violations.push(`${file}：${bytes} 字节，估算 ${bytes / 4} 令牌；上限 ${MAX_TOKENS} 令牌（${MAX_BYTES} 字节）`);
  }
  if (violations.length === 0) return;
  writeSync(2, '预提交检查失败：以下暂存文件超过令牌上限：\n' + violations.join('\n') + '\n');
  writeSync(2, `
请按职责把它拆成多个文件，每个不超过 5000 令牌：
- TS/JS：按导出的类/函数分组拆到同目录的新模块，原文件保留为重新导出的入口。
- 测试文件：按 describe 块拆分。
- Markdown：按二级标题拆分，原文件保留目录链接。
- JSON 或数据文件：迁到 data/，并在 .token-budget-ignore 里用 # 注释登记理由和对应 glob。
建议拆分文件名：foo.ts → foo.types.ts、foo.helpers.ts，再保留 foo.ts 作为入口。\n`);
  process.exitCode = 1;
}
try {
  main();
} catch (error) {
  writeSync(2, `文件令牌预算检查失败：${error.message}\n`);
  process.exitCode = 1;
}
