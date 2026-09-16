// Optional terminal capability: diagnose install failures without bypassing npm's script policy.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chmodSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let root;
let failure;
try {
  root = dirname(require.resolve('node-pty/package.json'));
  // node-pty 1.1.0 ships the macOS spawn-helper without executable mode in npm.
  if (process.platform === 'darwin') {
    for (const relative of [['prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'], ['build', 'Release', 'spawn-helper']]) {
      const helper = join(root, ...relative);
      if (existsSync(helper)) chmodSync(helper, 0o755);
    }
  }
  // A file's presence cannot prove ABI compatibility. Probe in a bounded child.
  const probe = spawnSync(process.execPath, ['-e', 'require(process.argv[1])', root], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  if (probe.error || probe.status !== 0) {
    failure = probe.error?.message || probe.stderr || `exit=${probe.status}, signal=${probe.signal}`;
  }
} catch (error) {
  failure = String(error);
}
if (failure) {
  const linuxHint = process.platform === 'linux'
    ? '\nLinux 缺少 pty.node 时需要 Python、make 和 C++ 工具链。确认脚本策略允许后，在 node-pty 包目录运行 node-gyp rebuild，或 node <npm 自带的 node-gyp.js 路径> rebuild。'
    : '';
  console.warn(`[xiaok] node-pty 不可用 (${process.platform}/${process.arch}, Node ${process.version}, ABI ${process.versions.modules})\n`
    + `包路径：${root ?? '未找到'}\n原始错误：${String(failure).slice(0, 8192)}\n`
    + 'sudo 交互能力暂不可用；请在自己的终端执行命令，或在 CLI 中手动输入 !<command>。\n'
    + '若 npm 拦截了脚本，可一次性授权：npm install -g --include=optional --allow-scripts=xiaokcode,node-pty,better-sqlite3,nodejieba,onnxruntime-node xiaokcode'
    + linuxHint);
}
