# OpenDuet package 验证入口（2026-11-01）

**恢复后最新状态：读取边界和祖先关联修复后的 recovery-lineage-final 完整 unsigned package、inspection 和真实隔离 GUI 重跑通过；1,468 个 dist 文件零差异。旧 GUI 脱离的自有 broker 已按唯一私有 cwd/PID 补查回收，最终剩余 0。详见[中断恢复验证](openduet-recovery-verification.md)，不把旧采样集零残留冒充完整清理。**

- [打包历史与 source/dist manifest](openduet-package-validation-history.md)：首次失败、依赖修复、全部 unsigned 命令、退出码、资源与 PID 证据、09:35 快照及后续差异。
- [隔离真实 GUI / preload smoke](openduet-package-validation-gui.md)：准备、失败修正、CDP 实际 preload 源码比对、真实 IPC/SQLite 检查、OS 隔离与清理边界。
- [CI package contracts](openduet-package-validation-ci.md)：Node 22.14/24 × 三 OS、Electron binary/xvfb、显式测试清单和本机检查；远端结果由主线程确认。
- [依赖修复窄设计与对抗自审](openduet-package-dependency-design.md)。[Kimi 独立静态评审](openduet-package-kimi-review.md)：两组 APPROVE 仅绑定受审文件 hash；首轮超时未批准，不覆盖后续合并的新 HEAD。

## 当前证据边界

09:35 快照完整打包和 inspection 均退出 0，真实 GUI 基础 smoke r4 退出 0；它们不覆盖之后主线程的 main/renderer 修改。原始 manifest、命令、包、截图与完整本地日志仅在已忽略的 `.artifacts/openduet-package-validation/`，不会提交 Git。没有新增 ignore 或绕过文档大小 hook。

实际 GUI 使用独立 userData、XIAOK_CONFIG_DIR、HOME 和 OS policy；没有连接真实日历、调用模型或写真实配置。r4 为避免外层 Seatbelt 与 Chromium 嵌套冲突使用测试进程 `--no-sandbox` 与 single-instance disable，不作为 Chromium sandbox/singleton 安全验收。进程残留 0 仅指记录并捕获的自有 PID 集，不能覆盖轮询前快速脱离的未知后代。

## 下一步

等主线程明确通知最终 main/renderer fresh build 完成，再以新的 run label 冻结输入、完整 unsigned pack 和 GUI smoke，并保留前后 source/dist/resource manifest。Windows 与远端 CI 结果不能由 macOS 结果替代。

提交只包含本任务 scripts/tests/workflow/review Markdown；不包含 `.app`、binary、SDK、冻结 dist 或完整私人日志。不安装用户 app、不签名、不发布或推送，不改 sibling WIP。
