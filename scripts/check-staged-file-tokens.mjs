#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 20_000; // 5,000 tokens, using the repository's bytes / 4 estimate.
const ALLOWLIST = 'scripts/file-token-allowlist.json';
const DIFF_ARGS = ['--cached', '--no-renames', '--no-ext-diff', '--no-textconv', '--diff-filter=ACMT'];

function git(args, input) {
  return execFileSync('git', ['--literal-pathspecs', ...args], {
    encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function isGeneratedPath(path) {
  const name = basename(path);
  return /(^|\/)(dist|node_modules|\.generated)\//.test(path)
    || /\.lockb?$/.test(name)
    || /^(Package\.resolved|packages\.lock\.json|gradle\.lockfile|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|composer\.lock|go\.sum)$/.test(name)
    || /\.(generated|gen|g)\.[^/]+$|\.pb\.(go|cc|h)$|_pb2(?:_grpc)?\.py$|\.snap$|\.map$/.test(name)
    || ['.lint-baseline.json', '.architecture-baseline.json', 'src/build-info.ts',
      'artifacts/cua-verification-runtime.js'].includes(path);
}

function readAllowlist() {
  // Like file contents, exemptions come from the index, not unstaged edits.
  if (!git(['ls-files', '--cached', '-z', '--', ALLOWLIST])) return new Set();
  try {
    const paths = JSON.parse(git(['show', `:${ALLOWLIST}`]));
    if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || !path)) {
      throw new Error('必须是非空文件路径组成的 JSON 数组');
    }
    return new Set(paths);
  } catch (error) {
    throw new Error(`${ALLOWLIST}: ${error.message}`);
  }
}

function stagedEntries() {
  const records = git(['diff', ...DIFF_ARGS, '--raw', '--no-abbrev', '-z']).split('\0');
  const entries = [];
  for (let i = 0; i < records.length - 1; i += 2) {
    const [, mode, , oid] = records[i].split(' ');
    // Do not follow symlinks or inspect submodule contents.
    if (mode === '100644' || mode === '100755') entries.push({ path: records[i + 1], oid });
  }
  return entries;
}

function generatedAttributes(paths) {
  const records = git(['check-attr', '--cached', '-z', '--stdin', 'linguist-generated'],
    paths.join('\0') + '\0').split('\0');
  const generated = new Set();
  for (let i = 0; i < records.length - 1; i += 3) {
    if (['set', 'true'].includes(records[i + 2])) generated.add(records[i]);
  }
  return generated;
}

function blobPrefix(oid) {
  // Read raw staged bytes, independent of HEAD, diff drivers and worktree attributes.
  // Bound memory and wait for the child to exit even after stopping an oversized blob.
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', 'blob', oid], {
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
    });
    let prefix = Buffer.alloc(0);
    let stopped = false;
    let stderr = '';
    child.stdout.on('data', chunk => {
      if (stopped) return;
      prefix = Buffer.concat([prefix, chunk.subarray(0, 8192 - prefix.length)]);
      if (prefix.length === 8192) { stopped = true; child.kill(); }
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0 || stopped) resolve(prefix);
      else reject(new Error(`读取暂存 blob 失败: ${stderr}`));
    });
  });
}

function hasGeneratedHeader(prefix) {
  const text = prefix.toString('utf8').replace(/^\uFEFF/, '');
  // Only leading comments count. A quoted example later in handwritten code must not exempt it.
  const header = text.match(/^(?:\s|#![^\r\n]*(?:\r?\n|$)|\/\/[^\r\n]*(?:\r?\n|$)|#[^\r\n]*(?:\r?\n|$)|;[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)*/)?.[0];
  return /(?:^|\n)\s*(?:\/\/|\/\*|\*|#|;|<!--)?\s*(?:@generated\b|Code generated\b[^\n]*DO NOT EDIT|(?:Automatically generated|This file (?:is|was) (?:automatically )?generated)[^\n]*(?:DO NOT EDIT|Do not modify))/i.test(header ?? '');
}

export async function main() {
  const entries = stagedEntries().filter(entry => !isGeneratedPath(entry.path));
  if (!entries.length) return;
  const sizes = git(['cat-file', '--batch-check=%(objectsize)'], entries.map(entry => entry.oid).join('\n') + '\n')
    .trim().split('\n').map(Number);
  if (sizes.length !== entries.length || sizes.some(size => !Number.isSafeInteger(size))) {
    throw new Error('无法读取暂存文件的字节数');
  }
  let oversized = entries.filter((entry, index) => {
    entry.bytes = sizes[index];
    return entry.bytes > MAX_BYTES;
  });
  if (!oversized.length) return;
  const allowlist = readAllowlist();
  oversized = oversized.filter(entry => !allowlist.has(entry.path));
  if (!oversized.length) return;
  const attributes = generatedAttributes(oversized.map(entry => entry.path));
  oversized = oversized.filter(entry => !attributes.has(entry.path));
  if (!oversized.length) return;
  const violations = [];
  for (const entry of oversized) {
    const prefix = await blobPrefix(entry.oid);
    if (!prefix.subarray(0, 8000).includes(0) && !hasGeneratedHeader(prefix)) violations.push(entry);
  }
  if (!violations.length) return;
  console.error('[file-tokens] 提交被阻止：暂存文件超过 5000 tokens（字节数 / 4；上限 20000 字节）。');
  for (const { path, bytes } of violations) {
    console.error(`  ${JSON.stringify(path)}: ${bytes} 字节 / ${bytes / 4} tokens`);
  }
  console.error([
    '请按职责拆分上述文件，每个文件保持 ≤ 20000 字节：',
    '  1. 将独立功能、类型、常量或辅助函数移到同目录下命名清晰的模块，更新 import/export。',
    '  2. 测试按功能拆为多个测试文件，共用 fixture 提取到辅助模块；文档按主题拆分并添加链接。',
    '  3. 保持行为和公共接口一致，运行相关测试，再用 git add -- <拆分后的文件> 更新暂存区并重试。',
    `历史大文件仅按精确路径豁免，见 ${ALLOWLIST}；新增手写大文件请拆分。`,
  ].join('\n'));
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch (error) {
    console.error(`[file-tokens] 检查失败: ${error.message}`);
    process.exitCode = 1;
  }
}
