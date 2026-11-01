# Assistant analysis 资源与安全解压

[返回 provider 入口](assistant-analysis-provider.md)。本文件按原二级标题拆分，保留各阶段已核实记录；历史scope不自动扩展至后续改动。

## 专用资源与安全解压

`assistant-analysis-resources.ts` 的 prepare/restore 为真实实现。prepare 仅显式配置时使用固定官方 HTTPS URL，redirect:error、60秒超时、64MiB大小限额，写入前验证 SHA256，无鉴权 header、无模型请求、无重试。已存在资源必须验证，损坏不自动覆盖修复。restore 无网络/无创建。并发同 root/Python prepare 共享进行中任务。

wheel：https://files.pythonhosted.org/packages/ea/e9/8b9dedbcd3aaabac393cd08c99a1c0f0670ea6493ac727fc2857bb4f88dd/deepseek_recipe-0.1.1-cp310-abi3-macosx_11_0_arm64.whl
SHA256：`cadb53a202960fc5d381f52a9c30afb0e44d7eaaa22197e851c09789bf65b83e`

tokenizer：https://raw.githubusercontent.com/deepseek-ai/deepseek-recipe/8cadfede7063c896b944e7bae05daa3549ae97ea/static/tokenizers/v41/tokenizer.json
SHA256：`81f64d1248a68ce3663e07ab3ee48b851e5df0e32d27cb98e4c9a268151e8d99`

使用已有解释器 `-I -S -B` 和固定 stdlib zipfile 脚本，不运行 wheel 安装代码。先检查全部条目，拒绝重复/绝对路径/.. /反斜杠/符号链接/加密/过多条目/解压膨胀。只提取固定七个 deepseek_recipe 文件，并逐文件验证与既有 counter 相同的 hash；dist-info 不解压。新建专用目录0700，不 chmod 共享目录。进程超时/取消按自己持有的 child 句柄终止，并等 close 后返回；不按名称杀进程。失败清理自己创建的 staging。

先 stage、原子 rename，再 inspect/freeze 整个解释器/stdlib/native依赖/package/tokenizer环境，离线计数已知 fixture=7，保存 manifest。restore 重算全部环境并与保存 manifest 比较；不是“目录存在就可用”。product-bootstrap.ts:106 的固定注册 ~/.cache/xiaok/sol-pi 目录本机不存在；本轮未伪造其注册，也未改其模块。Assistant 使用用户授权的独立 main-owned dataRoot 和相同正式冻结工厂。
