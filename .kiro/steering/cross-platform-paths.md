---
inclusion: fileMatch
fileMatchPattern: 'desktop/**'
---

# 跨平台路径处理（防 Windows 不兼容）

历史上多次因为路径处理只考虑 macOS/Unix，导致功能"只在 Windows 坏"：产物卡片不渲染、HTML 编辑保存失败、硬编码 `/Users/...`、`file://` 预览加载不出。改 desktop 路径相关代码时遵守以下约定。

## 统一使用 helper，不要手写分隔符 / URL

- Renderer（`desktop/renderer/src/**`）：一律用 `renderer/src/lib/file-path.ts`
  - `isAbsoluteFilePath(p)`：判断绝对路径（POSIX `/`、Windows 盘符 `C:\`、UNC `\\`）。不要用 `p.startsWith('/')`。
  - `fileBasename(p)`：取文件名（同时按 `/` 和 `\` 拆分）。不要用 `p.split('/').pop()`。
  - `toFileUrl(p)`：构造 `file://` URL（Windows 产出 `file:///D:/...`）。不要写 `` `file://${p}` ``。
- Main / Electron（`desktop/electron/**`，Node 环境）：用 `node:path` 的 `basename` / `dirname` / `resolve` / `relative` / `isAbsolute`。
  - 取文件名用 `basename(p)`，不要 `split('/')`。
  - 校验"路径是否在某根目录内"用 `resolve` + `relative`（见 `ipc.ts` 的 `isPathInside`、`skill-runtime.ts` 的 `referenceEscapesSkillRoot`），不要用字符串前缀启发式。
  - 拼路径用 `join` / `resolve`，禁止模板字符串硬编码 `/` 或 `\`。

## 安全相关的路径校验必须覆盖 Windows

- 路径逃逸 / 写入白名单校验要同时拒绝 POSIX 绝对路径、Windows 盘符绝对路径、UNC，并用 `resolve`+`relative` 做权威的包含判断。只查 `startsWith('/')` / `..\\` 在 Windows 上会被绕过。

## 禁止硬编码机器路径

- 不要在代码里写 `/Users/<name>/...`、`C:\Users\<name>\...` 这类具体机器路径。需要相对化时在运行时推导（如最长公共前缀，见 `ChangedFilesTree.tsx` 的 `relativizePaths`）。

## 子进程

- `spawn` / `exec` 用参数数组，不要假设 Unix shell 语法（`&&`、`|`、`$VAR`）。需要跨平台时用 `cross-spawn` 或分多步。

## 自动防回归

- `desktop/tests/main/cross-platform-path-guard.test.ts` 会扫描 `desktop/electron` 和 `desktop/renderer/src`，对以下反模式直接失败：
  - 手写 `` `file://${...}` ``
  - 以硬编码主目录路径开头的字符串字面量（`'/Users/...'`、`'/home/...'`、`'C:\\Users\\...'`）
- 新增同类合规用法（例如确需在 helper 内构造 `file://`）时，在该测试的豁免列表中显式登记并说明原因，而不是放宽正则。

## 验证

改跨平台路径逻辑后至少跑：

```bash
cd desktop
npm run test -- --run tests/renderer/file-path.test.ts tests/main/skill-runtime-path-escape.test.ts tests/renderer/changed-files-tree-relativize.test.ts tests/main/cross-platform-path-guard.test.ts
npm run build:main
npm run build:renderer
```
