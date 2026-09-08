# Codex 原生会话验证

Desktop 在原模型选择器中提供“本地 Codex”，复用标准任务输入、输出、工具步骤、审批和历史，没有独立菜单或页面。CodexTaskBridge 将原生事件转换为标准任务协议；session-probe.mjs 直接导出生产 transport。

```sh
node --test tests/evals/codex-native-session.test.mjs
cd desktop
npm run build:main
npm run test -- --run tests/main/codex-native-service.test.ts tests/main/codex-task-bridge.test.ts tests/renderer/chat-model-picker-native.test.tsx
cd ..
node scripts/evals/codex-native-session/service-live.mjs --live --output /tmp/xiaok-native-product.json
```

Node stdio 测试直接读取 TypeScript，需支持 type stripping 的 Node；本机用 Node 26.7.0。service-live 调用构建后的生产 service，实测立即追加队列、一次允许、拒绝、中断以及销毁并重建 service 后的持久上下文恢复。测试只写一次性临时目录。

run.mjs --live --output /tmp/xiaok-native-protocol.json 保留第一阶段 read-only 协议验证。task-live.mjs --live 验证生产标准任务 host。desktop-live.mjs --live 使用隔离 userData、配置和临时工作目录启动真实 Electron，验证原模型选择器、标准回复、追问和刷新恢复；--keep-open 保留体验窗口。旧独立页面验收属于历史记录，不代表当前集成的 UI 验证。

真实运行会使用当前 Codex 登录和默认模型，产生模型请求和持久原生测试会话。不修改全局配置或复制凭据；本次子进程关闭 hooks。Desktop 原生会话使用 workspace-write/untrusted/user reviewer，审批只允许本次 command/file，未知/permissions/elicitation/tool callbacks 默认拒绝；没有持久授权入口。第一阶段协议 runner 仍是 read-only。

报告保留脱敏 IDs、临时目录、各门结果。原生 Codex 自身仍按正常方式保存历史。Windows 只有入口分支测试，没有 Windows 实机证据。POSIX 清理本任务进程组，不声称能终止主动脱离进程组的任意后代。未验证签名安装包与正式发布。
