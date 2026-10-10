#!/usr/bin/env node
// 发布门禁：核对 `npm run pack:cli` 打出的 .tgz 里的 dist/ 与「当前提交从源码重建」的结果一致。
// 原因：pack:cli 不会先 build，仓库里已跟踪的 dist/ 可能是旧的（见台账：发布门禁以最终安装包为准）。
// 用法：node scripts/verify-pack-dist.mjs --tgz <xiaokcode-x.y.z.tgz> [--repo <dir>] [--ref <git ref，默认 HEAD>]
// 不改动 --repo 的工作区：用 git archive 导出到临时目录后在那里 build。退出码非 0 表示不得发布。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const tgz = opt('--tgz');
const repo = resolve(opt('--repo', process.cwd()));
const ref = opt('--ref', 'HEAD');
if (!tgz || !existsSync(tgz)) { console.error('用法：--tgz <path> [--repo <dir>] [--ref <ref>]；tgz 不存在'); process.exit(2); }

// 重建时会变、或由打包步骤另行放入，不参与逐文件比较。
const IGNORE_DIFF = [/^build-info\.(js|d\.ts)$/];
const ALLOWED_TGZ_ONLY = [/^runtime\/verification\/native\/win32-[^/]+\//];
// 必须不再出现 / 必须存在的关键内容（授权修复的代表性证据）。
const FORBIDDEN = [{ file: 'commands/chat.js', text: 'onPromptOverride: async () => true', why: '云之家工具确认自动批准（P0-1）' }];
const REQUIRED_FILES = [{ file: 'commands/project-rule-adoption.js', why: '项目放行规则需本机采纳（P0-3）' }];

const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function walk(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(root, full, out); else out.push(relative(root, full).split('\\').join('/'));
  }
  return out;
}
const run = (cmd, argv, cwd) => execFileSync(cmd, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });

const scratch = mkdtempSync(join(tmpdir(), 'verify-pack-dist-'));
const failures = [];
try {
  const src = join(scratch, 'src'); const pkg = join(scratch, 'pkg');
  execFileSync('mkdir', ['-p', src, pkg]);
  run('bash', ['-c', `git -C ${JSON.stringify(repo)} archive ${JSON.stringify(ref)} | tar -x -C ${JSON.stringify(src)}`], repo);
  run('tar', ['-xzf', resolve(tgz), '-C', pkg], repo);
  const sha1 = run('git', ['rev-parse', ref], repo).toString().trim();
  const nm = join(repo, 'node_modules');
  if (!existsSync(nm)) throw new Error(`${nm} 不存在，先在 --repo 里 npm ci`);
  symlinkSync(nm, join(src, 'node_modules'));
  run('npm', ['run', 'build'], src);

  const rebuilt = join(src, 'dist'); const packed = join(pkg, 'package', 'dist');
  const a = new Set(walk(rebuilt)); const b = new Set(walk(packed));
  for (const f of a) {
    if (IGNORE_DIFF.some(re => re.test(f))) continue;
    if (!b.has(f)) failures.push(`包内缺少：dist/${f}`);
    else if (sha(join(rebuilt, f)) !== sha(join(packed, f))) failures.push(`内容不同：dist/${f}`);
  }
  for (const f of b) if (!a.has(f) && !ALLOWED_TGZ_ONLY.some(re => re.test(f))) failures.push(`包内多出（重建结果没有）：dist/${f}`);
  for (const r of REQUIRED_FILES) if (!b.has(r.file)) failures.push(`缺少关键文件 dist/${r.file}（${r.why}）`);
  for (const r of FORBIDDEN) if (b.has(r.file) && readFileSync(join(packed, r.file), 'utf8').includes(r.text)) failures.push(`dist/${r.file} 仍含「${r.text}」（${r.why}）`);
  const want = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version;
  const got = JSON.parse(readFileSync(join(pkg, 'package', 'package.json'), 'utf8')).version;
  if (want !== got) failures.push(`版本不一致：源码 ${want}，包内 ${got}`);
  console.log(`检查对象：${tgz}\n对照提交：${sha1}\n重建文件 ${a.size} 个，包内 dist 文件 ${b.size} 个，版本 ${got}`);
} catch (error) {
  failures.push(`脚本执行失败：${error instanceof Error ? error.message : String(error)}`);
} finally { rmSync(scratch, { recursive: true, force: true }); }

if (failures.length) { console.error(`\n不通过（${failures.length} 项）：`); for (const f of failures.slice(0, 60)) console.error(` - ${f}`); if (failures.length > 60) console.error(` … 另有 ${failures.length - 60} 项`); process.exit(1); }
console.log('通过：包内 dist/ 与重建结果一致（build-info 与 win32 absence 文件除外），关键修复在。');
