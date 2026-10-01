# 发布打包检查兼容 Node 22

## 根因与设计

首轮 Desktop Release 36818598748 在 macOS signed package 的 afterPack 阶段失败：`node:sqlite is not a production dependency`。本机 Node 26 的 builtinModules 列表包含 prefix-only 内置模块，CI Node 22.23.2 的列表不包含；按此列表判别会误将 node:sqlite/node:test 等当第三方依赖。Node 22 官方文档明确此限制，并提供 module.isBuiltin。

只把 verify-packaged-runtime-dependencies.cjs 的内置模块判定改为 `specifier === 'electron' || isBuiltin(specifier)`，不变更扫描范围、生产依赖声明、ASAR 限制、Electron 实际导入检查及 cross-build 标记。不能 blanket 放过 node: 前缀；不存在的 node: 模块必须拒绝，裸 sqlite 仍是第三方包。

来源：https://r2.nodejs.org/docs/latest-v22.x/api/module.html#modulebuiltinmodules 和 #moduleisbuiltinmodulename。

## 对抗性设计评审

- 只改 builtinModules 列表为 startsWith('node:') 会把 node:unknown 放行：拒绝该方案，使用 Node 自身 isBuiltin。
- sqlite 裸包不能被当作 node:sqlite；必须增加拒绝测试。
- Ajv 缺失、dev-only、optional-only、目录外回退与缺子路径依然由现有真实 ASAR/Electron 回归拒绝。
- 同一 afterPack 入口用于 macOS/Windows：在真实 Node 22.23.2 下跑所有 packaged-runtime-imports 测试，保留两平台资源路径断言。
- 测试不能只在 Node 26 通过：用独立 Node 22 binary 先跑红灯，再修正后跑绿灯，并对已构建真实 app.asar 验证。

结论：设计可实施。先写回归，再改生产脚本；再做独立 Qoder 复审。

## 草稿发布恢复

此版没有正式发布或上传安装包。先取消失败构建并确认全部 job 停止；修复提交与测试证据 push master。关联仓库三枚固定标签不变。主 release tag 必须指向包含修复的确切提交，不能用旧 tag 配合 master dispatch 构建造成 tag/artifact 分歧。更新尚未发布的主草稿 tag 时使用远端旧 tag object SHA 的精确 lease，并记录旧目标、修复目标和新 run；已正式发布时不得沿用此恢复路径。

## Windows 同入口缺陷

首轮 Windows job 在同一个 gate 失败：`dist/main/desktop/electron/artifact-editing.js was not found in this archive`。@electron/asar getFile/searchNodeFromPath 按 native path.sep 分割，扫描器用于分类的 POSIX 文件名不能直接传给 extractFile；调用 extractFile 时使用 path.normalize(file)，保留 POSIX 文件名供范围判断与 TypeScript AST 标签。新增真实 ASAR fixture，用 Windows path.join/dirname/basename/normalize/sep 的真实实现模拟库的目录遍历，先红灯，后绿灯；不声称该模拟替代 Windows 真机导入。

## 持续回归

两平台 Desktop Release 安装 dependencies 后直接调用上述真实 ASAR/Electron regression suites，CI Node 22 每次执行。Windows 的路径用例直接用本机 ASAR API；仅 POSIX 主机临时替换 native path 目录遍历实现为 win32 进行回归模拟，finally 恢复，避免 Windows path.win32 与 path 同对象导致 spy 自递归。

## 本地验证证据

真实 Node 22.23.2 来自官方 tar.gz，SHA256 对照官方 SHASUMS256.txt。生产入口先复现 5 failed/17 passed，修订后 22/22 passed；本机 Node26 + cross-platform-path-guard 26/26 passed。对保留的真实 1.5.6 macOS app.asar 用 Node22 检查脚本并启动其实际 Electron，7 个外部静态 imports 全部通过。未降低声明/ASAR 边界，未改主进程产物。原 Desktop Cross-Platform Tests 36818593077 success；原发布 run 36818598748 所有 job 已停止，Mac/Windows 两项失败均有日志留存，草稿 assets 为空。

独立 Qoder 只读对抗性复审 R1、R2 均 PASS，未发现真实阻断。
