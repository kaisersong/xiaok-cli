# Assistant analysis 验证证据

[返回 provider 入口](assistant-analysis-provider.md)。本文件按原二级标题拆分，保留各阶段已核实记录；历史scope不自动扩展至后续改动。

## 设计自审与验证记录

实现前读取 AGENTS、guidance 权限/设计/验证/desktop/cross-platform 和实际 lessons-ledger（工作树 docs symlink dangling，使用 /Users/kk/projects/mydocs/xiaok-cli/quality/lessons-ledger.md）。遵守模型错误码/不无限重试、真实证据、进程归属规则。初版设计发现接口不足而先失败关闭，主线程要求继续后增加真实 recipe、资源和选择 service。每次扩展先更新设计/对抗自审、再写测试再改 production；raw日志保留 red/green，缺模块的 collection red 不冒充断言失败。

对抗自审覆盖：async estimate 不等于 exact；SDK和adapter双层retry；兄弟LoopLLMPort/assistant-llm不在本轮修复范围；caller true/callback不能晋升正式counter；丢弃normalized估算usage；原生结束与usage尾帧；坏hash不能执行；配置/环境key漂移；同ID重放；明确选择不得fallback。后补实际fixture发现解压 hash 常量转录错误，真实 prepare 红测失败，修正为与已有counter逐字一致后通过，未把失败藏为环境问题。

实际资源与证据：
- dataRoot：仓库 `.artifacts/assistant-analysis-provider-data`。
- service叶目录：`assistant-analysis-provider/recipe-0.1.1`，含 wheel/tokenizer/site-packages/manifest.json。
- 已有Python：`/Users/kk/.local/share/uv/python/cpython-3.11.15-macos-aarch64-none/bin/python3.11`；系统/usr/bin/python3为3.9.6，不作为本轮计数器。
- service manifest SHA：`ec0933c288c43268148ce16e83f5feaecee40f09911e9ff26a4b7e7741b8d4cb`。
- service contract.id：`assistant-analysis-v1:2a46eac475f024759edbb26ca60d767f59cfbc980c135fcdef7095a54f451161`。
- service contractHash：`ad78d22e152a8dbd6520408569c2e7d6c0ae27aae05d523c846356f22676b3a4`。
- 上述值仅为本机本次环境证据，不可写成其它机器的允许值。

日志：`.artifacts/assistant-analysis-all-green.log` 记录26项通过（含真实官方资源下载/安全解压、offline full-request 13 tokens、restore零网络）。`.artifacts/assistant-analysis-all-build.log` 记录desktop build:main退出0。后续新增空model/坏hash测试与最终治理结果在交付时追加。hygiene开工失败源自sibling intent-broker落后且有既有tracked WIP，未修改该仓库。没有真实模型调用、没有CI或安装包验收、没有独立Kimi通过结论。

最终边界：root model-identity.ts当前identity哈希配置文件字节，未包含跨重启环境变量key变化；本模块能拒绝本进程内binding漂移，但跨重启有效凭据身份须由主线程root reader/持久grant补齐，未在本轮冒充已解决。

## 最终范围与交付证据

按最后一次分工，删除本任务新增的 assistant-analysis-provider-service.ts 及其测试，不留第二套selection owner。只保留provider/resources三个新测试、本文档，以及授权修改的analysis-port.ts计量类型；未改main/runtime/types/共享provider adapters。

最终执行：
- `cd desktop && ASSISTANT_ANALYSIS_COUNTER_ENV=../.artifacts/assistant-analysis-provider-data/environment.json npm run test -- --run tests/main/assistant-analysis-provider.test.ts tests/main/assistant-analysis-resources.test.ts tests/main/assistant-analysis-provider-counter.test.ts`：exit0，27通过、0跳过，见 `.artifacts/assistant-analysis-final-scope-tests.log`。
- `cd desktop && npm run build:main`：exit0，见 `.artifacts/assistant-analysis-final-scope-build.log`。
- `npm run governance:check`：exit0，lint/architecture零新增违规，见 `.artifacts/assistant-analysis-final-scope-governance.log`。
- 用户指定既有 `/opt/homebrew/bin/python3.13` 单独执行真实资源prepare→计数13→restore零网络：1通过、1被测试名过滤，见 `.artifacts/assistant-analysis-python313.log`，不是全套无跳过。该测试约40秒（含下载/多次环境冻结/bootstrap）；不承诺异步API不阻塞main。
- 3.13 dataRoot：`.artifacts/assistant-analysis-provider-data-313`，叶目录同名规则；manifest SHA `d0f189265b44268c21b20aa0aa858600cf706dfed76e44eda7281421fd63cd27`，最终contract.id `assistant-analysis-v1:70381b6647a292e248e598c9b9d6f8861a5d81e139c188e2120ba20cec194bc1`，contractHash `29126708b9bbfbfb555a1cb326520174329843b3e24ac8ef79790faa38cd0d36`。
- 所有本任务测试/build子进程已结束；未启动持久后台服务，遗留自有后台服务0。资源解压child等待close，计数器spawnSync返回后才报告。

接线时优先在已有managed Python初始化后取getManagedPythonCommand；resolvePythonCommand（src/platform/plugins/install/dependencies.ts:53）可返回XIAOK_PYTHON_CMD或python3，资源helper现在可用PATH解析简单名称到绝对路径。无Python时unavailable，不从cwd猜路径，不硬编码本机路径入production。只明确用户按钮走prepare，启动恢复仅restore。

剩余主线程事项：selection settings/UI/IPC接线、runtime await、durable attempt/budget settlement（特别是contract breach安全数值usage）、质量授权与跨重启环境key grant身份、最终完整HEAD独立Kimi复核。未执行真实模型调用/CI/安装包验收，不宣称这些完成。
