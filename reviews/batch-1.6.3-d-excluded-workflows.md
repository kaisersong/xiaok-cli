# 1.6.3 D 批未纳入的 workflow 补丁

本文件只说明阻塞，不修改 `.github/workflows`。

`reviews/batch-1.6.3-d-excluded-workflows.patch` 相对固定基准 `b8d1f3bf9cb2bcd14890f0bdb6cbab4d4389a7bb` 的 workflow 原文，尚未应用。本整合分支上的 `.github/workflows` 与该基准逐字节一致。

## 来源

- `#183` `55de18c003ab83e60157ba81d806fdb8e90327c7` 想把三个回归文件登记进 `.github/workflows/desktop-cross-platform.yml`。相对当前 master 的可自动合并结果只有这三行新增，没有删除 master 上已有用例。
- `#121` `067c02f0513a08e9e449e8bbc25ed7c56f8beb9b` 与 master 的唯一内容冲突在 `.github/workflows/terminal-ui.yml`。冲突两处都是同一行位置上 master 的已有用例与 PR 的新用例互斥：`question-transcript-spacing.py` 对 `version-statusline.py`，以及对应的 artifact 路径。补丁保留两侧，并保留 master 的 macos-15、nodejieba cache、segment 与 yzj 路径。`src/commands/registry.ts` 只是从原位置挪到新增路径组，仍然是触发路径。

## 阻塞

本任务禁止推送 `.github/workflows` 变更，也不索取 workflow 权限、不跳过 hooks。因此上述登记不在本批分支中。在创始人或 CTO 另行合入该补丁之前，不能把 CI 说成已经覆盖这些新增用例。
