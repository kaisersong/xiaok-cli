# CLI 无关配置更新后的 transport 快照恢复

根因：runtime-config.resolveTransport 关闭在启动 snapshot 上。readPublic.resolve 检查整个 config.json 与 bak 的 digest；新增 provider、编辑无关选项也令后续请求永久失败。

方案：readPublic 提供 credentialVersion(path)，从已捕获 raw 的 ref 或明文值计算不可逆摘要，不访问后端、不泄露明文。runtime 首次解析 transport 时记录当前所选 provider 的公开配置、选中 model entry、默认选择以及所选凭据 path/version。每次请求新读 public snapshot，对比该指纹；相同才从新 snapshot 解密，并保持逐项及最终版本检查。不同则仍 credential_config_changed；不自动换 endpoint/provider/key。selectModel 保持原始 snapshot 的 CAS，避免旧 models 覆盖新增模型。旧快照存在明文迁移时允许自身迁移后更新已接受的指纹，且该更新在 transport 成功后完成。

边界：resolveTransport 是三个 concrete adapter 共用入口，clone 也继承该 resolver；无凭据和 env-key 也必须校验 endpoint。备份变化由新 snapshot 自己验证，不影响当前 active transport；禁止无界重试。首次请求前的相关变更也拒绝。

验证：先新增真实生产 runtime 入口回归，无关配置、新增无关凭据允许；所选凭据撤销/替换、endpoint、model、headers 改变拒绝且无 fetch；旧 selectModel CAS 保持拒绝；测试后运行构建、governance。

## 设计对抗审（DeepSeek deepseek-v4-pro，2026-11-11）处理

设计阶段源码尚未实现，B4 为实现阶段验收要求。B1/A2 的读取顺序判断错误：resolve 的 current() 在 paths 检查之前执行；仍增加 env-key 回归。B2 保留 CAS 是刻意避免旧 models 覆盖新增模型；模型切换的合并策略不在本轮，不能放宽为无条件重试。B3 解密结果在 current() 成功之后才 return，异常时 resolver 不返回 transport；现有逐项/最终校验保持。B5 深度限制是既有输入验证议题，不因本轮扩大；新增摘要不使用递归。以上不同意项均需在实现审重核。

## 实现与验证结果

- 编码：Codex GPT-6；独立评审：DeepSeek，脚本实际绑定 provider=deepseek、wireModel=deepseek-v4-pro（原始 result.json 留于本轮 /private/tmp/runtime-refresh-final-review）。复审明确撤回明文迁移 blocker，结论「本轮实现无阻塞缺陷」。评审全文见同目录 cli-runtime-refresh-deepseek.md。
- 原始安装入口的 runtime-config.js 置入 emitted test runtime 后，新回归 `continues with the same selected transport` 失败，报 credential_config_changed（runtime-refresh-red.log）；恢复修复版后 88/88 通过。
- `npm run test:sandbox:build`：通过。
- `npm run test:sandbox:run -- .test-dist/tests/utils/runtime-config.test.js .test-dist/tests/utils/protected-json.test.js .test-dist/tests/utils/config.test.js`：3 文件、88 测试通过。旧 protected-json async CAS 测试曾使用未隔离的凭据目录，本次改为 fixture.root 并 finally 恢复环境变量；不访问用户凭据。
- `npm run build`：退出 0。dist/build-info 是验证产物，不纳入提交。
- `npm run governance:check`：退出 0，lint 0 new、architecture 0 new。不更新 baseline。
- 开工 `npm run hygiene:check`：失败，fetch/default-head freshness unverified；原主 checkout 有其他任务 settings WIP，本轮采用独立 worktree。
- 未验证：真实在线会话热替换、Windows 实机、CI、最终安装包。当前安装入口不自动覆盖；用户已有进程仍持有原版模块。
- 本轮未启动独立后台服务；所有测试由 runner 完成退出。

本轮经验：整文件 CAS 应留在写入边界，长期运行的只读 transport 则应绑定实际消费的 provider/model/credential identity。执行机制为上述无关配置新增与 selected transport 拒绝两组生产入口回归。
