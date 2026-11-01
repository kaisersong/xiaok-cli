# 云之家 CLI 日历只读接入（P2）

2026-11-01，用户已明确以云之家CLI替代Google为首个来源，Google后续接。已核对npm @yunzhijia/cli 0.1.8 README、包内calendar.md/global.md及官方CDN二进制help。下载在私有临时目录，无全局安装；后续已由用户完成独立 profile 登录并进行了真实只读验证，见文末。

## 当前证据与窄范围

- 原生命令 calendar event list --start --end 与 calendar event get --id 存在；list没有page/page-token参数。
- 成功stdout JSON信封包含success/identity/data；列表为data.list，可伴随count/more/total/pageToken/lastUpdateTime。identity区分user/app。错误由exit code及stderr JSON返回。
- CLI使用OS keychain和独立--profile；本功能不复制token，不使用任意endpoint/debug/jq，仅读固定两条calendar命令。auth login为用户交互，不是background refresh行为。
- 发布包的scripts/run.js会在缺二进制时自动安装，并包含Windows回滚逻辑；adapter不调用该shim，只接收main核实的原生绝对路径，不将外部CLI放进普通prompt组装。

先写测试，实现只读transport/回执解析；这是P2基础，不等同真实来源已接通。实际事件字段/稳定身份/循环实例/取消/时间语义需真实账号或官方schema确认后做normalizer；未确认前不能进正式晨报，也不能声称P2完整验收。

## 契约

YzjCalendarCliReader只公开listEvents({from,to,signal})、getEvent({id,signal})。binary path/profile由main composition传入，非renderer payload。每次读取前后重验main grant(profile/epoch/account binding)，不同epoch拒绝返回；没有当前grant不spawn。结果只在本机main中返回，不含credentials；原stderr不进入error.message。

只spawn原生二进制，shell=false；timeout 30秒，stdout/stderr捕获上限1MiB，取消杀本次子进程。日期用已实测的Unix毫秒（当前业务窗口，>=1e12），窗口为[from,to)转CLI包含端点；不接受任意命令名、flags或URL。成功还需success=true、identity=user及形状合法；app身份默认拒绝。

列表完整性：more=false且无next pageToken/计数矛盾，才能对“CLI所返回列表”的枚举标complete。more=true/pageToken/total>list.length标partial；缺完整性证据标unknown，裸[]不当checked。这里不是最终事件规范化coverage或provider分页快照保证，上层必须保守处理。无显式分页能力，不循环重发同请求假装补齐。

## 编码前对抗性评审（自审）

- login/连接与后台读分开；列表命令不自动login/logout，不偷偷授权或修改profile。
- 事件ID/profile拒绝空/超长/控制字符；用argv单参数传值，固定枚举命令，不shell拼接。
- 旧grant在进程执行/JSON解析期间撤销：返回前重验，丢弃晚到数据。
- 非零exit即使stdout像成功也不能接受；stderr原文可能含个人数据，错误仅输出稳定code。
- malformed/count不符/缺more均不能完整；unknown不是空。
- 包装器未发现现成枚举/凭据owner的证据不等于可以新建通用凭据系统；CLI继续唯一持有其凭据。
- 需要不同模型review；合成响应仅证明transport和parser，不证明云端接口的真实语义。

## 尚待后续

user-only source settings+durable grant/epoch、主进程CLI定位和版本身份、登录UX、真实schema/规范化、staging/checkpoint同事务、撤权遮蔽、晨报接入、Windows/macOS安装包与真实provider验收。


## 用户工作环境约束（2026-11-01明确要求）

云之家为用户真实工作环境。现阶段仅读，不修改/取消/删除已有日程。以后只有用户明确交办才可创建；默认只建个人日程，不添加参会人、不邀请同事、不预订会议室、不发送他人通知。该约束不是创建授权；当前adapter仍完全不提供任何create/update/delete/participants mutation入口。后续新增创建能力时必须保持个人范围并另有负测。


## 真实只读验证（已登录独立profile）

用户本人完成登录；contact user get成功且identity=user。2026-11-01至11-08查询成功返回18条、18个不同id，startDate/endDate均为整数毫秒。list回执只含count/list，无more/pageToken，因此transport必须返回unknown而不是complete。detail实测有timeZone/repeat/batchId/cancelTime等，但枚举/循环实例语义尚未证明。

发现真实0.1.8不接受2026-10-31T16:00:00.000Z（exit2，validation/invalid_time）；+00:00无毫秒格式和Unix毫秒均成功。已先将生产argv回归改为毫秒并观察失败，再修production。该真实行为证据与mock测试分开记录；无任何日历写调用。

真实响应曾在本任务临时目录以0600暂存以检查字段结构，未写repo/夹具/共享评审；字段检查完成后已删除私有响应文件，只保留去身份结构和数量证据。用户的登录 profile 保留。
