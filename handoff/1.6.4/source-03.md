## 三、质量门禁清单（缺一不可，例外须创始人书面确认）

1. **自动化门禁**：候选 SHA 上 CI 全绿（尤其 `Desktop path tests` 双端、`-t` 筛选步、`Startup and room`、`CLI Startup`、`Terminal UI`），新增/修复用例均有实际执行日志（非 skipped）。
2. **Windows 重点真机门禁**（补齐 1.6.3 欠账）：
   - `yzjw` 与 `ilucas` 上 `1.6.2 -> 1.6.4` 升级及空白首次启动均通过：legacy 数据按 SID/ACL 安全收编，**会话列表可打开、历史消息可读、可正常发送**（不再出现 `continuity_unavailable` 阻断）。
   - 关闭窗口后 `tasklist` 无残留进程，端口与安全边界（`#237`/`#238`/`#243`）验收通过。
3. **macOS 真机门禁**：`kmm` 上 `1.6.3 -> 1.6.4` 自动更新与三次连续启动（不触发误迁移、正常 attach）通过。
4. **文档与产物门禁**：macOS dmg/zip/`latest-mac.yml` 与 Windows exe/`latest.yml` 哈希一致，发布说明仅写实合且实测内容。
5. **低版本 macOS 门禁**（质量 2026-11-15 提出）：
   - NSAlert 卡死弹窗的来源必须查清，不能只凭「升级后没再出现」判定修好；在 kmm 降级环境稳定运行 5 分钟以上不卡，并贴出 broker health 原文。
   - 去掉 `22.6.0` 前，必须用真实 `latest-mac.yml` 在 Darwin 21.x 上跑一遍更新检查；新 Electron 支持的最低 macOS 要实测核对。

---

