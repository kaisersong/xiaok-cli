# Xiaok Windows CLI 1.5.7 启动热修复

适用于 CLI 启动崩溃日志包含 `startupPhase: platform`、`EPERM`、`platform/runtime/context.js:95` 的情况。
该行写入工作区能力状态缓存；热修复使缓存 I/O 失败时继续启动，并保留旧缓存。
只替换安装目录中的 `health-store.js` 与类型声明，保留备份；不修改用户配置、会话或项目。
安装器严格校验版本为 `xiaokcode 1.5.7`、原文件和补丁 SHA-256，拒绝覆盖未知修改。

将 `xiaok-windows-cli-1.5.7-health-hotfix.zip` 复制到 Windows 并解压。
在解压目录打开 PowerShell，正常退出仍在运行的 xiaok CLI 后执行：

```powershell
node .\apply-health-cache-hotfix.mjs (Join-Path (npm root -g) 'xiaokcode')
xiaok
```

安装成功会输出 `backup` 路径。重复执行会报告 `alreadyApplied: true`。
如不是 npm 全局安装，把第二个参数改成实际包含 xiaokcode/package.json 的安装目录。
只检查、不写入可在命令末尾加 `--dry-run`。

如果工作区本身受限，这个修复只能保证健康状态缓存不阻断启动；实际文件编辑仍按原有权限执行。
当前 npm 的 1.5.7 包仍包含旧代码，单独执行 `npm update -g xiaokcode` 不会应用此热修复。

仓库内调用方式：

```powershell
node .\scripts\apply-health-cache-hotfix.mjs (Join-Path (npm root -g) 'xiaokcode')
```
