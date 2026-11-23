## 一、前置警示：1.6.3 当前实际状态与延期复盘（1.6.3 已于 2026-11-15 09:04:49 UTC+8 正式发布，本节保留为复盘）

> **重要事实核对**：截至 **2026-11-14 01:31（北京时间）**，**`1.6.3` 仍未正式发出（已合入代码，卡在发版脚本重跑门禁）**：
> - PR [#233](https://github.com/kaisersong/xiaok-cli/pull/233)（`f14525e2`）已通过 `kmm` 全套冒烟与质量第一步放行，并于 11-13 16:15 附近合入 `master`（`0bdc5590a19a42f4cb01857ee111f0f2ee492c2f`），已打 `desktop-v1.6.3` tag。
> - 首轮发版工作流因 `desktop-release-identity.mjs` 查询草稿返回 404 失败，修复 PR [#247](https://github.com/kaisersong/xiaok-cli/pull/247) 已于 11-13 16:46（北京时间）合入；随后又暴露 `/releases` 查询缓存导致空草稿 `444005370` 报错，CTO 已提交修复 PR [#248](https://github.com/kaisersong/xiaok-cli/pull/248)（`b8e66660`，质量已审核通过）。
> - 当前唯一卡点：PR [#248](https://github.com/kaisersong/xiaok-cli/pull/248) 被 `governance (windows-2022)` 中无关的 30 秒 `node_modules` 拷贝超时卡在 `BLOCKED`；创始人已拍板「按建议来」（重跑失败 job 并合入 `#248` → 删空草稿 `444005370` → 移动 `desktop-v1.6.3` tag 重新出包 → 替换 Windows 1.6.2 资产、定稿 `/workspace/dev/r163/release-notes-1.6.3-draft.md` → 质量第二步放行发布）。

### 1.6.3 延期根因复盘与 1.6.4 防延期硬规则
- **1.6.3 为何拖延多日**：
  1. **单版塞入范围过重**：A/B/C/D 批 + `#209` 等多线重构叠在同一版本，导致桌面、CLI、CI 偶发超时（`#150/#162/#199/#226` 等）长期交替暴露。
  2. **跨平台隐患在临发布前暴露**：`#233` 直到 11-12 19:13 在 `yzjw` 实测非 legacy 降级根才暴露 `desktop:context:listConversations` 报 `continuity_unavailable` 致列表打不开、无法发消息；11-13 08:05 创始人拍板 **1.6.3 仅发 macOS，Windows 1.6.3 延至 1.6.4**。
  3. **推送滞后与脚本兼容踩坑**：方案 A 测试修复 11-13 09:02 本地完成但 10:04 才推送（`d8415172`），且 `npm run test --` 在 Windows PowerShell 吃掉 `-t` 参数，又多等一轮到 15:02 才推 `f14525e2`。
- **1.6.4 防延期 5 条硬规则**：
  1. **按「1 个核心目标 + 明确 P0 清单」锁范围**：1.6.4 核心目标是**补发 Windows 桌面版（含 #244/#245）+ 修齐 1.6.3 留下的已知限制与高优 bug**；不额外塞大型无关联重构。
  2. **本地改完 5 分钟内必推送**：任何定位/修复提交在本地跑过目标用例后立即推送，并附 `git ls-remote` 或 commit SHA 到群里，不隔小时漏推。
  3. **Workflow / 跨平台命令一次用对**：涉及 `vitest` 筛选传参统一走 `shell: bash` 直接调 `node node_modules/vitest/vitest.mjs`，禁止在 Windows PowerShell 用 `npm run test --`。
  4. **交接 10 分钟 ACK + 1 小时熔断**：群内 `@` 交接 10 分钟内必须报明确 ETA；非 P0 阻塞项卡点超 1 小时且影响发版节奏的，由产品经理/CTO 拍板切出到 1.6.5 并写入延期表。
  5. **打包与真机验证窗口不跨夜**：CI 首跑过门禁后立刻锁 `kmm`/`yzjw`/`ilucas` 验证窗口；测试结束 5 分钟内发群给书面结论，Release Notes 随合并同步去占位符定稿。

---

