# 打包依赖闭包修复：窄设计与对抗自审

范围仅 packaging 脚本与精确契约测试；不改产品源、manifest、sibling/共享依赖。

## 证据及设计

实际 ASAR 缺少 cross-spawn 的 path-key/shebang-command，但共享安装目录中存在；已有 afterPack 没有 dependency-copy，未解决。设计在本会话 commentary 先记录、测试先红后实现；本文件持久化该设计，不声称更早落盘。

新增 copy-packaged-dependencies，在全部原门禁前遍历最终 ASAR manifest 的 production/optional/runtime peer 依赖图，按照已安装 npm 树的嵌套布局补齐最终包，不安装依赖，不遍历 devDependencies。缺失必需源依赖拒绝，可选依赖缺失或不匹配目标平台跳过。已存在包版本不符拒绝覆盖；相同版本继续检查传递依赖。保留原 ASAR 每项的 link/executable/unpack 元数据，新增依赖全包 unpack，保证 native/worker/data 的普通文件语义。源包内部 symlink 目前 fail closed。

临时 ASAR 写好才替换；规划失败不动原包。ASAR 与 unpacked 目录并非跨目录原子事务，任何 I/O 失败均使打包失败，中间产物不得发布。所有原 freshness/runtime/service/runtime-closure/helper 门禁保留。

## 对抗自审（Codex GPT-6，同模型自审，非独立模型批准）

- 只复制 path-key 不能覆盖其他 collector 漏项：遍历 production graph。
- 平铺破坏不同版本：保留 installed nested node_modules，测试两 leaf 版本。
- 开发依赖掩盖缺包：补齐实际 ASAR，保留包内 Electron import 门禁，不设置 NODE_PATH。
- 重写损坏 native unpack：ASAR streams 保留元数据，测试真实 unpack 字节及标记。
- optional 与 required 混淆：required 缺源拒绝且原包不变；optional 缺失容许。
- 循环无限递归：source+target 访问集；parent/leaf 环测试。
- 对已有包静默覆盖：已存在版本不一致测试必须拒绝。
- 并行 build：冻结 dist FileSet 独立打包；最终主线程 fresh build 后重新跑全部门禁。
- 不触及真实 profile、云之家或日程写；本任务 subprocess 清除签名凭据、禁签名/公证；未声称跨模型安全批准。
