# 默认文件凭证存储（仅 file / keychain）

用户明确要求：仅支持文件和钥匙串，默认文件，优先方便使用；已授权迁移当前凭证并更新 PR #208。

现状：systemCredentialBackend 固定 keyring；ProtectedJsonFile 在配置中保留 owner/path 绑定的 UUID 引用。保留此引用协议与读写/worker 边界，只替换后端选择。

方案：
- 私有配置根下新建 credentials/，POSIX 0700；store.json 为 0600，包含 version、backend（file 或 keychain）与 UUID→encoded bound record 的 entries。默认无文件即 file；普通配置和 /settings 仍不含密钥。文件模式是用户指定的明文凭证存储，不宣称加密。
- 默认新凭证只写文件，既有文件条目读取不接触 OS。旧 UUID 在文件中缺失时，尝试从原钥匙串读取并原子写入文件，验证后复用原引用；不删除原钥匙串条目。错误不返回空对象、不删除配置。
- 仅提供 `xiaok config get credential-store` 和 `xiaok config set credential-store file|keychain`。状态读取不解密模型配置。切换 keychain 时先逐条写入并验证，全部成功后一次原子替换 store.json 的 backend 和空 entries，避免留下文件副本；中断前旧 file 状态完整，中断后新 keychain 状态完整。切回 file 时原引用按需导入，不枚举系统钥匙串。
- get 为原子文件快照读；put / 导入提交 / 切换用专用短期进程锁、nonce 与死 PID 回收。切换锁内重新读取 mode，阻止并发写入丢失或在切换后重新写明文。活锁返回 busy，损坏锁拒绝。
- 专用目录/文件拒绝 symlink、非本人、hardlink、目录替换；打开用 NOFOLLOW 并比对 fd/stat。只收紧专用目录与文件，绝不递归改共享 ~/.xiaok。JSON 校验只接受 version=1、合法 mode 和 UUID/string entries；错误不回退另一后端。Windows 保持同路径规则及用户 profile ACL，不依赖 POSIX mode。
- Electron main 仍不能直接访问凭证；新后端同样沿 credential worker 使用。当前旧 Desktop 安装包不在本轮改写范围，原 OS 条目保留以兼容它；新配置凭证在更新 Desktop 前不保证旧二进制识别，PR 明示。

先设计对抗审，再写生产入口回归，最后实现。测试包括默认零 keyring 调用、私有权限、旧引用导入与下次离线读取、两种模式切换、迁移/写入/切换故障时旧数据不变、并发锁、路径/owner/硬链接、worker 实际 file backend、CLI get/set 不输出秘密、现有 strict/partial/CAS 回归。实际安装备份后只替换本轮模块，不 npm link；迁移记录只记字段名与数量，不打印 Key，最后真实模型调用验证，不以“启动成功”代替可用。

设计审 gpt-6-astra：有条件通过。补入：所有写入（含native写/回读）和导入同一vault锁，拿锁重读entries防旧值覆盖，绝不反向获取配置锁；Windows专用路径用受限DACL（当前SID、SYSTEM、Administrators），无法落实ACL即拒绝，不只跳过chmod；原子替换前失败保旧状态，替换后只保证新状态完整，确认失败报结果未知。选择file不读取配置，钥匙串不可读也能选，旧引用之后按需导入。

## 实现与最终评审

编码模型 GPT-6（Codex）；独立评审模型 gpt-6-astra。评审发现并修复了三项 P1：超出 8 MiB 上限必须在提交前拒绝、目录及锁被替换时拒绝继续、死进程锁回收必须有独占竞争保护。最终安全及文案增量评审通过，无新增 blocker。五个核心源码组合 SHA256 为 `c807b8e4fa23e88584418cd409d94a85ececa6b32ae5e8292730937576edd609`。

实际生产入口回归命令与结果（各组有重叠，不相加）：

- `npx vitest run tests/utils/credential-store.test.ts tests/utils/credential-store-integration.test.ts tests/utils/protected-json.test.ts tests/utils/config.test.ts tests/utils/runtime-config.test.ts tests/commands/chat-login-bootstrap.test.ts tests/ai/models.test.ts tests/ai/adapters/claude.test.ts tests/ai/adapters/openai.test.ts tests/ai/adapters/openai-responses.test.ts tests/ai/adapters/openai-responses-native.test.ts tests/ai/runtime/model-harness-identity.test.ts tests/ai/agents/subagent-executor.test.ts --reporter=dot`：13 suites，416/416 通过。
- `npx tsc -p tsconfig.tests.json` 后执行 `node node_modules/vitest/vitest.mjs run --config vitest.sandbox.config.mjs --configLoader runner .test-dist/tests/utils/credential-store-worker.test.js .test-dist/tests/utils/credential-store-integration.test.js .test-dist/tests/utils/credential-store.test.js --reporter=dot`：3 suites，18/18 通过；真实 main→worker 写入后更改文件摘要，强制未命中缓存的读取也通过。
- Desktop：`npm run test -- --run --environment node tests/main/credential-input-service.test.ts tests/main/memory-credential-settings.test.ts tests/main/connectors-store.test.ts`：3 suites，14/14 通过。
- 本地交互命令相关回归：4/4 通过，68 项未选中。
- `npx tsc --noEmit`、`npm run build`、`npm run governance:check`、`npm run architecture:check -- --changed` 通过；lint 与架构均无新增违规。
- 独立评审者另外执行 38/38 源码用例及实际 worker 的写入、摘要变更后读取，均通过。

已知基线：完整 `tests/commands/config.test.ts` 有一个 DeepSeek 显示名称断言失败。使用改动前的 `9410fd6f` 配置处理器复现相同失败；本轮新增的存储命令集成测试通过。没有宣称全仓测试通过。Windows 受限 DACL 只验证分支和 runner stub，未在 Windows 真机验证；已安装 Desktop 二进制未重打包。PR 为依赖 #182 的堆叠分支，未合并、未发布 npm。

## 本机安装与迁移证据

先备份本机 CLI 的八个目标模块再安装并逐个校验 SHA256。配置命令只应用 credential-store 增量，保留安装版本原有命令。`xiaok --version` 返回 1.6.2（本地补丁），`xiaok config get credential-store` 返回 `file`。安装后的实际 worker 写入、强制冷读与取消检查通过。

通用 Node/security 读取旧钥匙串条目失败；Keychain Access 的访问控制页显示条目只信任已有 xiaok 应用。未修改 ACL，使用该应用现有读取权限完成旧引用导入。实际结果：5 条凭证、文件权限 0600、专用目录 0700；配置迁移前后 SHA256 均为 `6924ebd03172002ce388aee4bcbe6af8842a3c4a8abbd5801bac55b8aeb77af9`，原钥匙串条目保留。随后普通 Node/CLI 读取当前模型凭证成功，直接模型接口验证 HTTP 200、回复 `OK`。没有输出密钥或认证头。

本机原始日志、安装清单、迁移与模型调用结果保存在本任务私有 artifact 目录，不提交含本机状态的文件。磁盘 ENOSPC 曾阻断迁移结果写入，清理本任务生成输出与 npm 下载缓存后解决；未删除其他 worktree 或源代码。
