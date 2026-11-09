# 1.6.3 D 批 workflow 登记状态

本文件替代旧的“本整合分支的 workflow 与 b8d1f3bf 逐字节一致、补丁尚未应用”声明。该声明已不适用于后续集成候选。

核对基准：`1fe9a448a46a18741bb7e663eb2aac65eaf5a03b`。

## 已登记的来源

- `#183` 原提交 `55de18c003ab83e60157ba81d806fdb8e90327c7` 的三个回归文件，均已出现在当前 `.github/workflows/desktop-cross-platform.yml` 的实际命令中：
  - `tests/main/desktop-tool-execution-policy.test.ts`
  - `tests/main/desktop-multi-agent-catalog-bridge.bdd.test.ts`
  - `tests/main/desktop-multi-agent-capabilities.bdd.test.ts`
- `.github/workflows/terminal-ui.yml` 同时登记了 `question-transcript-spacing.py` 与 `version-statusline.py` 的实际执行命令，保留对应产物路径。

这些结论来自该完整 SHA 的 workflow 原文及来源提交差异；登记存在不等于实际 CI 已执行通过。

## 仍需区分的证据

- 当前候选的完整 CI、最低 Node 矩阵与正式安装包/tgz 验收须以实际运行日志确认。
- 交接文档将 `tests/support/**` 的完整 paths 覆盖调整列入后续改进；当前 workflow 只登记了具体支持文件，不能写成已完成整个目录覆盖。
- 私有文档 sibling 的读取凭据尚未配置，相关 CI 权限阻塞保留。

旧文件提及的 `reviews/batch-1.6.3-d-excluded-workflows.patch` 在上述完整 SHA 的 Git tree 中不存在，不能再作为可直接应用的当前补丁引用。
