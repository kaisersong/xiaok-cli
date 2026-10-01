# 首次登录 Coding Plan 与启动恢复

## 证据与范围

登录当前只有 provider 选择。Kimi 指向普通 Moonshot key 控制台但默认使用 Coding K3；
GLM 默认使用普通 API 地址。probe 使用 registry 地址，而保存会保留 existing.baseUrl，
因此验证和实际访问可以指向两个服务。密码输入期间 readline 和 raw data 两个监听者
同时存在，readline 可能回显 Key。Windows 崩溃报告的给定路径当前不存在，已请求实际路径，
在拿到证据前不将 ONNX 降级提示或鉴权失败认定为启动崩溃根因。

## 设计与对抗性评审

- 登录 Kimi/GLM/MiniMax 增加普通 API / Coding Plan 选择，脚本支持 --plan api|coding。
  Kimi 普通 API 使用 Moonshot endpoint 与 K2.6；Coding 使用 Kimi endpoint 与 K3。
  GLM Coding 使用专用 coding endpoint 与 5.3。MiniMax 同时显示套餐和普通 Key 来源。
- 显式套餐选择覆盖旧 endpoint；无套餐参数的非交互重登保留代理和 headers。
  --base-url 支持国际服务或代理，probe 与保存共享最终 endpoint。
- 默认模型按所选服务建模；重登切换套餐不能继续复用 incompatible model entry。
- 隐藏输入独占 stdin：每个普通 question 结束关闭 readline；secret 期间只有 raw
  data handler，submit/EOF/Ctrl+C 均清理监听和还原 raw mode，不调用 process.exit。
- 普通 TTY question 同样用 raw owner，Windows 从套餐菜单到密码期间保留 raw mode，
  完成/取消整个登录后再恢复。回归已证明原 rapid cooked/raw toggle 在此流程仍存在，
  使用既有 retainRawInputModeForSession 消除这个独立的 Windows 输入缺陷。
- 401/403 清楚提示服务选择或 Key 权限；不误将其它 HTTP 错误声称为网络不可达。
- 不改变其它 provider、Jev/System One、已有会话和全局 installed chat runtime。
- 回归调用真实 runLoginCommand/CLI command 和 TTY harness，验证 endpoint、model、
  custom proxy、无效计划拒绝、Key 不回显、EOF/Ctrl+C 后无残留监听，Windows startup gate。

## 崩溃报告证据补充

用户提供的 Windows 报告只有 Error/UNCLASSIFIED_ERROR，现有 sanitizer 丢弃了全部错误位置，
无法反推历史错误。新增白名单 startupPhase 与 whitelist 模块的行列位置（不保存 raw stack、
函数名、绝对路径、message 或对话），以及白名单 cause code；report version 从实际 package
读取。需要在 Windows 复跑才能确认该机器的原始故障是否还有其它原因，不声称已证明根因。

## 官方证据

- https://www.kimi.com/code/docs/en/ ：Coding 与开放平台地址、模型、Key 控制台。
- https://docs.bigmodel.cn/cn/coding-plan/faq ：编码套餐地址与普通 API 余额区别。
- https://platform.minimax.io/docs/token-plan/quickstart ：订阅 Key 与按量 Key 不通用。
- https://docs.z.ai/devpack/tool/others ：国际 Coding Plan 使用 api.z.ai 专用地址。

## 验收结果与限制

- npm run build 与 tests TypeScript build 均通过。
- 源码登录、bootstrap、key probe、crash privacy、Windows CUA boundary 47 项通过。
- 已安装版本 staged login 22 项通过，含 Windows raw ownership 的失败前/通过后回归。
- 源码与 staged CLI 首次登录→套餐选择→隐藏 Key→发消息→退出、既有 ask_user 与
  exit/resume 共 22 项通过。合计 91 项通过。
- 当前全局 1.5.6 已选择性安装 7 文件补丁并保留版本与已修复的退出逻辑。
- Windows 1.5.5/1.5.6 可用补丁包位于 artifacts/xiaok-login-plan-hotfix.zip，安装器
  对 payload SHA-256、JS syntax、package version、chat patch boundary 做校验并先备份。
- 尚未在 Windows 实机复跑用户的历史崩溃；原报告不能提供根因证据。已修复可复现的
  Windows raw/cooked 输入切换缺陷，但不能据此宣称旧 UNCLASSIFIED_ERROR 已完全解决。
