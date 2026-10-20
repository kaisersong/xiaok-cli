# Harness² v46 P0a

```sh
npm run eval:harness2:static
npm run eval:harness2:static -- --output /tmp/harness2-p0a-new.json
npm run eval:harness2:static:test
```

命令只读本仓固定源码，调用已有生产诊断入口处理合成输入，无 provider、
网络、用户配置或用户记忆访问。输出文件独占创建，不覆盖既有证据。
默认 JSON 输出到 stdout；输出到文件时目录须已存在。

- `p0a`：当前三个固定操作的 256 个公式状态，验证 `D(C)≤0`。
  `stop_paid_reflect` 是成功的静态结论，命令退出 0。
  过选成本反例单列且不影响当前 V；结果不外推所有 reflect 机制。
- `diagnostics`：真实 `diagnoseTraceBundle` / `diagnoseProjectSnapshot`
  的合成入口结果；结构化 code 映射 NO_ENTRY，未知 code/schema 保持未知。
- `inventory`：指定源码的 SHA-256、行号和职责。CLI 的记忆注入、Desktop
  的独立 prompt 和离线 scorer 分别标明；不能把这份表当成目标运行面的 E_target。
- `d0`：固定 `not_started`，列出本工具未收集/验证的真实前置证据。
  此字段指研究准入，不报告本机工程实现进度；工程底座见
  [本机 D0 记录](../../../reviews/harness2-d0-local-design.md)。
  此命令不接受研究 manifest，也不认证实验权限、预算、ROI 或产品资格。

源码缺失、核对锚点改变、非法参数或既有输出文件使命令退出 1。
命令不创建候选，不接终态订阅，不派发 reflect/probe/formal 请求。

依据：[v46 原方案](https://github.com/kaisersong/mydocs/blob/74e9fb7/xiaok-cli/design/2026-10-20-harness2-opt-in-optimization-design.md)
§10.1、§11、T15.1。实施边界及对抗自审见
[评审记录](../../../reviews/harness2-static-preflight.md)。
D0/P2a/P2b 须继续遵守原方案的真实材料/等价/预算/可靠性/完整联合功效门，
未满足前不能先开发基础设施或公开开关。
