import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { BUILD_INFO } from '../build-info.js';
import { XIAOK_BUILD_FLAVOR, XIAOK_BUILD_ID } from '../build-flavor.js';

const packageFile = fileURLToPath(new URL('../../package.json', import.meta.url));
let packageVersion: string | null = null;
try {
  const parsed = JSON.parse(readFileSync(packageFile, 'utf8')) as {version?: unknown};
  if (typeof parsed.version === 'string') packageVersion = parsed.version;
} catch {}

export function getInstalledVersion(): string { return BUILD_INFO.version ?? packageVersion ?? 'unknown'; }

export function getVersionInfo() {
  const entry = process.argv[1] ? resolve(process.argv[1]) : fileURLToPath(new URL('../index.js', import.meta.url));
  let actualEntry = entry;
  try { actualEntry = realpathSync(entry); } catch {}
  return {
    version: getInstalledVersion(),
    build: {...BUILD_INFO, flavor: XIAOK_BUILD_FLAVOR, id: XIAOK_BUILD_ID},
    runtime: {node: process.version, platform: process.platform, arch: process.arch,
      entry: actualEntry, packageRoot: dirname(packageFile)},
  };
}

export function formatVersionInfo(info = getVersionInfo()): string {
  const missing = '未记录';
  const clean = (value: string) => stripVTControlCharacters(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
  return [
    `xiaok v${info.version}`,
    `构建时间：${info.build.builtAt ?? missing}`,
    `构建类型：${info.build.buildType ?? missing} / ${info.build.flavor}`,
    `构建标识：${info.build.id}`,
    `源码提交：${info.build.commit ?? missing}`,
    `源码分支：${info.build.branch ?? missing}`,
    `源码时间：${info.build.sourceDate ?? missing}`,
    `源码状态：${info.build.dirty === null ? missing : info.build.dirty ? '包含未提交改动' : '已提交'}`,
    `构建环境：Node ${info.build.node ?? missing} · ${info.build.platform ?? missing}/${info.build.arch ?? missing}`,
    `运行环境：Node ${info.runtime.node} · ${info.runtime.platform}/${info.runtime.arch}`,
    `实际入口：${info.runtime.entry}`,
    `安装目录：${info.runtime.packageRoot}`,
  ].map(clean).join('\n') + '\n';
}
