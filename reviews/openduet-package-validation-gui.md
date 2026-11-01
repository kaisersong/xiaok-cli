# OpenDuet 隔离真实 GUI / preload smoke

[验证入口](openduet-package-validation.md) · [打包历史](openduet-package-validation-history.md) · [GUI smoke](openduet-package-validation-gui.md) · [CI](openduet-package-validation-ci.md)

准备阶段与实际执行结果按时间保留；最新基础通过绑定 09:35 输入快照，后续 final build 尚待重跑。

## 最终包 GUI smoke 准备（未运行，等待 fresh final build）

主线程通知最终 build 完成前，不打包、不启动 GUI、不改 dist。新增本任务脚本 `desktop/scripts/smoke-packaged-openduet.cjs`（可作为 CI 提交中的 script；不包含二进制/原始日志）。只执行了 `node --check` 与 `--help`，均退出 0；**尚未实际运行，不能当 GUI 通过证据**。

准备执行的命令（在仓库根，且仅在主线程通知 final fresh build 和完整打包门禁通过之后）：

```sh
node desktop/scripts/smoke-packaged-openduet.cjs \
  --app .artifacts/openduet-package-validation/final-fresh/package/mac-arm64/xiaok.app \
  --output .artifacts/openduet-package-validation/final-gui-smoke
```

脚本使用已有 Playwright Electron（Browser plugin 不可用），实际 app executable + 显式 `--user-data-dir=<新建临时目录>/userData`，并设置子进程独立 `XIAOK_CONFIG_DIR=<临时目录>/config`、HOME/XDG/tmp/sidecar data 路径。只向该目录写无 providers/models、后台总开关关闭的测试配置，不读或修改真实配置，不继承 API key、模型 endpoint、dev server、pilot、broker socket 等环境。main 中读取 app.isPackaged/userData/config 路径，检查实际 BrowserWindow 的 ASAR preload、contextIsolation/nodeIntegration，并调用真实 preload 读取状态，未注入 fake preload。

验证顺序：真实首页可见 → 默认 needs_consent、至少两个真实助理 schedule 全 paused、0 runs/launches、周期检查/通知关闭、日历未连接、分析模型未配置 → 通过真实 user-only pause API 仅暂停临时测试助理 → 打开 source（日历只读连接）、quality、model、periodic 控件。只切换 quality 的本地人工复核 checkbox，不实际导入/导出；不 activate/resume、不准备模型、不执行检查、不连接日历、不创建或修改日程。最后再次读同一真实 IPC，并在关闭后只读核对临时 SQLite 的 analysis attempts / launch operations / active claims 均为 0。截图及本地日志仅写入被忽略的 output。

main 当前固定 KSwarm/broker 端口 4400/4318（kswarm-service.ts 常量）；脚本启动前检查 IPv4/IPv6 监听，如果端口被占用就拒绝启动，绝不停止/采用现有用户服务。该检查不是允许并发启动其他 app 的保证；运行期间仍须主线程保证该 smoke 独占本次应用启动窗口。

脚本从启动前开始记录自己的 Electron 子树 PID 和 ps 启动时间；先正常 app.close，必要时仅按自有记录且启动身份匹配的 PID 清理，绝不用名字/端口匹配 kill。确认无残留后删除自己的临时 profile，留下 result/截图/日志；任何断言或 cleanup 失败都退出非零。此脚本仅提供 macOS packaged GUI smoke，Windows 交由主线程 draft PR CI 矩阵，不能互相替代。

## 真实 GUI 取证及脚本修正

首轮 `final-gui-smoke` 退出 1，失败是验证脚本要求 `getLastWebPreferences().preload` 返回路径，但本机 Electron 实际返回 undefined（原采集表达式确实包含 preload，JSON 因 undefined 省略字段）。当时真实 main 已启动，isPackaged=true、userData/config/cwd 均在新临时目录，真实 preload API 已可见。该失败未伪装产品通过，临时 profile 与自有进程均已回收。

没有放松 preload 检查：改为 CDP Debugger 读取实际加载的 `/.../app.asar/dist/main/desktop/electron/preload.cjs` 源码，逐字包含匹配 ASAR 原源码，保存 SHA256；还必须通过真实 preload methods、IPC、contextIsolation=true/nodeIntegration=false、实际 packaged file URL、非空首页检查。

首次日志观察到应用自己的 updater 查询，所以后续 smoke 用 `/usr/bin/sandbox-exec` 施加仅 localhost 网络、仅自己临时 profile 内文件写的外层 OS policy。strict policy 下 Chromium singleton 的账户级临时 socket 目录创建被拒，且 Chromium 子沙箱不能嵌套；`basic-gui-r2`/`r3` 均退出 1，并记录且清理，无成功宣称。为继续隔离 GUI 测试，仅测试进程显式使用 `XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE=1` 和 `--no-sandbox`，保留外层 OS policy，对 app/children 均生效。**此 pass 不是 Chromium sandbox 或 singleton 安全验收**；普通首轮已验证默认 singleton 的基础启动，不把两种配置混写为同一次结果。

OS policy 实测独立 probe 退出 0：试写本任务 evidence 根（位于允许的临时 profile 之外）被拒；对保留 TEST-NET 地址建立 TCP、不发送应用负载的探针立即 EPERM（`os-isolation-probe.json`）。没有测试真实业务 endpoint。updater 的诊断文本不当作联网或更新成功证据。

最终基础 smoke 命令：

```sh
node desktop/scripts/smoke-packaged-openduet.cjs --app .artifacts/openduet-package-validation/final-fresh/package/mac-arm64/xiaok.app --output .artifacts/openduet-package-validation/basic-gui-r4
```

**退出 0**（`basic-gui-r4-command.log`、`basic-gui-r4/result.json`）：

- actual main PID 30324、runner PID 30322；isPackaged=true，命令行明确 `--user-data-dir=/private/tmp/od-gui-YCUiY0/userData`，XIAOK_CONFIG_DIR 在同一独立 root。
- CDP actual preload URL 指向该 ASAR，包内 preload source SHA256 `dda87c382f169a998c89b9f86f83215398bec801768b586289b5a5639a3a9ecd`，source matches=true；页面为该包 `dist/renderer/index.html`，title=xiaok。
- 初始 needs_consent，两个真实 built-in 助理 schedules 均 paused；运行/交办 0。周期检查/系统通知关闭，未连接日历、0 event，模型未配置、modelCount=0，quality 未通过。
- 仅对临时 profile 调用真实 pause API，再展开 source/quality/model/periodic 控件；人工复核 checkbox 只改变前端状态并恢复，不点导入/导出、连接/记忆授权/模型准备/立即检查，不 activate/resume，不创建任何任务或日程。
- 五张实际截图 default/source/quality/model/periodic 保存；人工查看 source/model，1280×820 实际 UI 可读、控件存在。pageErrors=[]、consoleErrors=[]。截图/完整日志均在 ignored artifact 根，不提交。
- 关闭后只读实际 SQLite：assistant_analysis_attempts、assistant_launch_operations、assistant_active_work_claims 均 0；自有进程 remaining=[]，无需 kill，临时 profile removed=true。不读取真实日历、不调用模型、不写真实 config，不安装/签名/发布。
