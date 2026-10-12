#!/usr/bin/env node
// 1.5.13 门禁（草稿，质量）：同一版本号的 Desktop tag 与 CLI 包必须来自同一个完整 SHA。
// 用法：node check-release-sha.mjs --repo <本地克隆> --sha <40位完整SHA> --version <x.y.z> (--tgz <包> | --npm | --no-package) [--verify-script <verify-pack-dist.mjs路径>]
// 退出码：0 全部通过；1 有不一致，或没有提供包来源（防止漏参数造成假通过）；2 用法错误。确实只想检查 tag 和版本号时必须显式写 --no-package。不修改仓库，不发布。
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const a = process.argv.slice(2);
const opt = n => { const i = a.indexOf(n); return i < 0 ? undefined : a[i + 1]; };
const repo = resolve(opt('--repo') ?? '.'), sha = opt('--sha'), version = opt('--version');
let tgz = opt('--tgz'); const useNpm = a.includes('--npm'); const noPackage = a.includes('--no-package');
const verifyScript = opt('--verify-script') ?? join(repo, 'scripts/verify-pack-dist.mjs');
if (!/^[0-9a-f]{40}$/.test(sha ?? '') || !/^\d+\.\d+\.\d+$/.test(version ?? '')) { console.error('用法：--sha 必须是40位完整SHA，--version 形如 1.5.13'); process.exit(2); }
const git = (...x) => execFileSync('git', ['-C', repo, ...x], { encoding: 'utf8' }).trim();
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '通过' : '不通过'}：${name}${detail ? '（' + detail + '）' : ''}`); };
const peel = ref => { try { const o = execFileSync('git', ['-C', repo, 'ls-remote', 'origin', ref, ref + '^{}'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(l => l.split(/\s+/)); const p = o.find(l => l[1].endsWith('^{}')) ?? o[0]; return p?.[0]; } catch { return undefined; } };
try { git('cat-file', '-e', sha + '^{commit}'); } catch { try { git('fetch', '-q', 'origin'); git('cat-file', '-e', sha + '^{commit}'); } catch { check('完整 SHA 存在于仓库', false, sha); process.exit(1); } }
check('完整 SHA 存在于仓库', true, sha);
for (const tag of [`desktop-v${version}`, `cli-v${version}`, `v${version}`]) {
  const t = peel(`refs/tags/${tag}`);
  if (!t) { if (tag.startsWith('desktop-')) check(`tag ${tag} 存在`, false); else console.log(`跳过：tag ${tag} 不存在`); continue; }
  check(`tag ${tag} 指向 ${sha.slice(0, 8)}`, t === sha, t === sha ? '' : `实际 ${t}`);
}
try { const v = JSON.parse(git('show', `${sha}:package.json`)).version; check(`源码 package.json 版本 = ${version}`, v === version, `实际 ${v}`); } catch (e) { check('读取源码 package.json', false, String(e.message).split('\n')[0]); }
let tmp;
if (useNpm) { tmp = mkdtempSync(join(tmpdir(), 'qa-npm-')); try { const out = execFileSync('npm', ['pack', `xiaokcode@${version}`, '--pack-destination', tmp, '--silent'], { encoding: 'utf8' }).trim().split('\n').pop(); tgz = join(tmp, out); console.log('已下载 npm 包：', tgz); } catch { check(`npm 上存在 xiaokcode@${version}`, false); } }
if (tgz) {
  const r = spawnSync('node', [verifyScript, '--tgz', tgz, '--repo', repo, '--ref', sha], { encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n');
  check(`包内容与 ${sha.slice(0, 8)} 重建结果一致（verify:pack-dist 退出码 ${r.status}）`, r.status === 0, r.status === 0 ? '' : lines.filter(l => l.includes('不通过') || l.startsWith(' - ')).slice(0, 8).join('；'));
} else if (noPackage) console.log('未测：按 --no-package 跳过包内容核对');
else check('提供了包来源（--tgz、--npm 或显式 --no-package）', false, '包内容核对是关键项，不允许默认跳过');
if (tmp) rmSync(tmp, { recursive: true, force: true });
process.exit(results.every(Boolean) ? 0 : 1);
