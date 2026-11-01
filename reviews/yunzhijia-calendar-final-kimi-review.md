**APPROVE**（复核模型：Kimi；编码：Codex GPT-6）

依据（仅针对本次兼容性改动，前版已 APPROVE 部分不复查）：

- 改动范围收敛：仅 `--start/--end` 由 ISO 毫秒 Z 改为 Unix 毫秒字符串（`String(from)` / `String(to - 1)`），半开窗口语义用 `to - 1` 保留，无本地时区/DST 漂移风险；bundle:88。
- 新增 `from >= 1e12` 下限消除了秒/毫秒歧义（秒级当前值约 1.7e9，必然被拒），配合原有 `isSafeInteger`、`to <= from`、8 天上限，校验是收紧而非放松，bundle:84-85。`String()` 对安全整数不产生小数或科学计数法，无注入面（execFile、shell:false 不变）。
- 无新增权限：仍只有 `list`/`get`，grant/consent 前置校验与 epoch 前后比对逻辑（bundle:49-71）未动，写调用证据为 0。
- 验证路径合规：先改测试复现（1 失败 11 通过）再修代码（12 通过），真实生产入口 0.1.8 读 18 条、identity=user，证据链完整。

未发现 P0/P1 阻断。遗留说明（非阻断）：CLI 拒绝 ISO Z 的行为依据来自 bundle 自述与测试结果，我未独立运行 yzj-cli 复验，属转引。
