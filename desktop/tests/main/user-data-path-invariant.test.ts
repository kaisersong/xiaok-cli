/**
 * userData 路径不变式。
 *
 * Chromium 的 PathService 会缓存 DIR_USER_DATA —— 首次读取即固化。`main.ts` 里有
 * `app.setName('xiaok')`，如果它在首次读取之前执行，userData 会从
 * `~/Library/Application Support/xiaok-desktop` 变成 `.../xiaok`，而后者在真实机器上
 * 已被另一个应用占用（内含 miniapp / All Users，无任何 Electron 产物）。
 * 知识库、日志、Chromium 状态都会静默指向那个目录。
 *
 * 在加固之前，路径还正确的唯一原因是一句模块作用域的 debugMain 恰好在 setName 之前
 * 调用了 app.getPath('userData')。也就是说删掉一行"无用日志"就会搬走用户数据。
 * 这些断言把那个隐式依赖钉成显式契约。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mainPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'electron', 'main.ts');
const source = readFileSync(mainPath, 'utf8');

/** 只保留真实代码行 —— 注释里提到 `app.setName(` 不该触发顺序断言。 */
const codeLines = source.split('\n').map((line, index) => ({ line, index }))
  .filter(({ line }) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
  });

function firstCodeLineMatching(pattern: RegExp): number {
  const hit = codeLines.find(({ line }) => pattern.test(line));
  return hit ? hit.index : -1;
}

describe('userData path invariant', () => {
  it('pins userData into a module-scope constant', () => {
    expect(source).toMatch(/const USER_DATA_DIR = app\.getPath\('userData'\);/);
  });

  it('resolves userData before any app.setName call', () => {
    const pinLine = firstCodeLineMatching(/const USER_DATA_DIR = app\.getPath\('userData'\);/);
    expect(pinLine).toBeGreaterThan(-1);

    const setNameLine = firstCodeLineMatching(/app\.setName\(/);
    if (setNameLine === -1) return; // setName 被移除也满足不变式

    expect(pinLine).toBeLessThan(setNameLine);
  });

  it('routes every userData read through the pinned constant', () => {
    // 只允许钉常量那一行直接调 app.getPath('userData')；其余必须复用它，
    // 否则又会出现"某处先读、某处后读"的顺序依赖。
    const directReads = codeLines.filter(({ line }) => /app\.getPath\('userData'\)/.test(line));
    expect(directReads).toHaveLength(1);
    expect(directReads[0]!.line).toContain('const USER_DATA_DIR');
  });

  it('keeps the app name that produces the xiaok-desktop userData directory', () => {
    const pkg = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'),
    ) as { name: string; productName?: string };

    // userData 目录名取自 package.json 的 name（productName 优先级更高）。
    expect(pkg.name).toBe('xiaok-desktop');
    expect(pkg.productName).toBeUndefined();
  });
});
