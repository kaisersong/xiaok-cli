# Windows 1.5.6 首次会话保存失败

## 证据与设计

用户报告 chat.js:1289:28 和 4745:13；从 npm 下载原版 1.5.6，应用 login-plan 补丁后，两处分别是首次 `sessionStore.save` 和 `await runChat`。原版包包含 Windows absence reader，却不包含它固定读取的 EXE/manifest。将真实发布包的 process.platform 设置为 win32 后，真实 FileSessionStore.save 在 ensureRoot 抛 `ordinary_source_route`，与报告位置一致。未修改用户配置、会话或检查逻辑。

修复补齐 reader 已要求的固定路径 `dist/runtime/verification/native/win32-x64/windows-installation-absence.{exe,json}`。新只读 helper 从 Windows KnownFolder API 获取 ProgramData，不用环境变量定位；检查固定 common-folder 子目录及 HKLM 64 位安装登记，重复查询两者。仅所有观测明确 absent 才 ordinary；任何安装痕迹 installed，权限/IO/未知 unavailable。目录父句柄打开时禁止删除共享，拒绝父 reparse，前后比较父身份。安装状态查询不赋予受保护执行权限，不绕过现有 reader。

补充源代码、可复现编译/复制脚本、npm prepack gate，打包时发现 reader 却漏 native 文件就立即失败。追加 crash allowlist 中的固定会话保存模块及错误标识，继续不记录原始 message、绝对路径、key。单独新补丁，不覆盖用户已有 chat runtime。x64 是用户实测架构；arm64 仍必须另外编译并校验，不能冒充已支持的跨架构产物。

## 对抗性评审（实施前）

- 不可把 win32 无条件当 ordinary：保持原 wrapper 与检查；installed/unknown 测试必须拒绝保存。
- 不可用 `%ProgramData%` / HKCU / 可传入路径覆盖机器事实：native 固定 KnownFolder 与 HKLM 64 位路径，拒绝额外参数。
- 不能仅凭子目录 ENOENT：先打开并核父目录，注册表 parent 也必须成功打开，读失败不可视为 absent。
- 不可只测自行重写的逻辑：portable C 测试调用实际 core；JS 测试导入 npm 包实际 reader/profile/store，并替换其 OS process 边界。
- 新 helper 必须与包 manifest 摘要一致，损坏/缺失/更换前后文件/超时拒绝；发布 gate 必须实际检查包路径与 PE 架构。
- 普通 save、后续 save 和 last-session 恢复必须通过真实 FileSessionStore 验证；installed/unknown 不得写文件。
- macOS 交叉编译及 OS 边界注入无法证明 Windows EXE 真正运行。交付需附 Windows 只读自检命令，准确说明未进行 Windows 实机运行。

## 验证

- `npm run build` 与 tests TypeScript 编译通过。
- native core/packaging 3 项通过；core 覆盖四份观测的 81 种组合。
- npm 发布包真实 reader/profile/FileSessionStore 的 Windows x64 分支 7 项通过：拒绝 installed/unavailable、首次 K3 保存、再次保存、loadLast、缺 manifest 原始失败、篡改、查询中更换文件、超时/坏输出/参数覆盖拒绝。仅 OS 子进程返回注入，存储与 reader 为真实发布包代码。
- crash reporter 与 Windows CUA package boundary 11 项通过。真实发布包新 reporter 也正确记录 `ordinary_source_route`、file-store frames 和 1.5.6 版本。
- MinGW-w64 严格警告交叉编译通过；PE32+ x86-64 架构和系统 DLL import 已检查。不是 Windows 实机执行。
- 新 Windows MSVC 编译/原生只读 smoke workflow 已写入，尚未提交或运行。ARM64 helper 尚未编译；包含 Windows reader 的正式 npm pack gate 要求两架构齐备。
- portable installer 在完整发布包成功应用并重复运行验证；payload SHA 校验及 reader 保留。新 ZIP 输出 `artifacts/xiaok-windows-startup-hotfix.zip`，同摘要复制到 KK Downloads，尚未复制到 Kai。
