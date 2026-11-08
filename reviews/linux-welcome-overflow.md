# 欢迎框长元数据溢出

## 现状与设计

- 用户已确认 Ubuntu UID 0 启动补丁生效；新截图显示 Session 与 Version 越过欢迎框右边界。该截图只证明启动进入输入框，不代表生成请求验收。
- `renderWelcomeScreen` 固定左列 32 格，右列按终端列宽计算；`padVisible` 对超过列宽的文本直接原样返回，`centerVisible` 也如此。真实 sess_UUID 长于已有测试的短 session-safe-width，因此先前“未超过终端”测试不能证明“未超过单元格”。
- 保留既有框架、颜色与宽度分配；每个单元格先按已有 text-metrics.truncateAnsi 的显示宽度截断，保留三个 ASCII 点作为省略号，补齐到精确列宽。截断 ANSI 彩色内容后补 SGR reset。居中内容过宽同样走有界填充。
- 全部 cell 共用一个边界，覆盖 Session、版本/构建时间、长模型名、中文工作目录、提示与 logo。短文本保持原样；窄于 50 格的原 compact fallback 不扩展本次范围。
- 不通过隐藏整行、仅扩大 welcome 上限或修改会话 ID/版本底层事实解决展示问题；完整会话 ID 仍由既有退出/恢复路径提供。

## 实施前对抗性评审

- 只测“总长不超过终端”会漏掉截图问题：断言所有框内行与顶边框宽度严格一致，且中线位置一致。
- 直接按字符串 slice 会把中文按一格处理，或切断 ANSI 序列：使用现有显示列宽截断工具，覆盖彩色/无色和 Unicode/ASCII frame。
- truncateAnsi 不自动补 reset：截断分支必须显式恢复 SGR，避免边框继承正文样式。
- 先以真实 sess_UUID 和构建时间在多个终端宽度下触发旧实现失败，再修改 production；核验返回 rowCount 与实际不换行输出相符。
- 用真实 npm 1.6.1 render 模块和 PTY 验证补丁前后；临时安装器只替换已校验原模块中的对应局部代码，不能覆盖其它安装修复。

## 验证结果

- 原 npm 1.6.1 在 64 列时：边框 63 格、Session 行 86 格、Version 行 69 格；真实 tmux PTY 复现了折行与边框错位。
- `npm run test:sandbox:build` 通过。新增 16 个列宽/ANSI/边框组合在修改前全部失败；修复后 `npm run test:sandbox:run -- .test-dist/tests/ui/render.test.js .test-dist/tests/ui/scroll-region.test.js .test-dist/tests/ui/scroll-region-return.test.js .test-dist/tests/ui/text-metrics.test.js` 共 174 项通过。
- `npm run build`、`npm run governance:check`、`npm run architecture:check -- --changed` 通过；不提交重建 dist/build-info。
- `python3 tests/e2e/welcome-frame-width.py --module <原 npm 1.6.1 的 dist/ui/render.js> --output-dir <本任务临时证据目录>`：应用临时补丁后，50/64/80/120 列 × Unicode/ASCII frame 共 8 个真实 PTY 场景全部对齐。测试使用独立 tmux socket，仅关闭自己的 session。
- `scripts/apply-welcome-width-hotfix.mjs`：固定版本与原文件 SHA、与生产构建 render.js 逐字节相同的补丁后 SHA、语法校验、原文件备份、重复执行、错误版本/文件时无写入均通过；此前 UID 0 补丁文件逐字节保持一致。
- `render.test.ts` 全文件加入 Terminal UI 的跨平台 Node 22.14.0/24 CI；真实 PTY 用例加入已有 Linux tmux step，push/PR 路径过滤同步覆盖。
- 开工 hygiene 检查被 sibling intent-broker 的已有未提交修改及 plugins 的既有未跟踪产物阻断；本任务未改动它们。
- 原用户 Ubuntu 安装版的视觉验收仍待应用补丁复跑；本地 PTY 不冒充用户终端验收。
- 独立 GLM-5.3 / glm-5.3-flash 代码评审请求分别在 120/90 秒超时，未计为通过；本文件记录的实施前对抗性检查与本地回归不替代后续 PR 独立质量验收。
