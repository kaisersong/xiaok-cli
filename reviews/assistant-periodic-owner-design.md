# P3周期检查与既有活动通知owner

现状：LoopLLMPort只返回text，没有供应商token硬上限/计量契约；现有activity只有watch通知、claim-before-OS，不能当作assistant policy实现。新增能力默认关闭；没有真实质量资格和main私有AnalysisPort就budget_unavailable/quality_unverified，绝不借用旧complete绕预算。

## 分工与数据

LoopStore同连接持有policy、logical clock、attempt、digest意图、notifiable revision ledger。新增固定assistant-check loop仅由既有TimedActionScheduler interval调度，缺资格永不active；手工检查也走相同gate/预算。工作日当地08:00–20:00、默认240分钟/最小30分钟、singleflight；过期周期不逐条补跑。原晨晚loop不变。

AnalysisPort由main注入：provider/model/tokenizer contract固定，measureInput覆盖system/data/包装，maxOutputTokens由provider强制，返回usage或unknown。没有可证明契约的adapter不安装。reserve+run attempt在Loop事务内提交，sent前先写sent；sent/unknown不重发，缺usage保守全额扣除。模型输出仍经过相同v2引用校验/current source与publication，保护型来源没有共同协议则不开放。质量资格必须来源于真实完整来源全集的至少100例/30需要行动及人工复核与冻结precision/recall/严重漏报评估，不接受模型输出的qualified标志。

差集由main结构化事实身份+固定action kind/deadline/eventRevision计算；标题/摘要改写不产生新revision。差集空不建delivery不占额度。意图+revision claim+滚动24h≤2/间隔≥4h配额同事务；unknown不退回、不重复响。正文/联系人不进通知。

## 投递

复用ConversationActivityService/OwnerHost，不创建第二notifier或轮询。新增producer-only assistantDigest RPC，严格envelope={profileId,deliveryId,policyRevision,revisions}，用户role/agent不能提交。owner从固定本机Loop数据库只读查询实际意图/当前policy/profile status/source epoch，不信envelope中的授权；缺表/资格保持suppressed。actor/rootHash仍由原owner认证。

ActivityStore单owner保存delivery claim（claim-before-OS，默认unknown），重复相同delivery只返回旧结果；不同内容冲突拒绝。实际OS调用前同步重验最新policy和quietHours（含跨午夜）、source epoch、assistant暂停、通知opt-in、平台能力。suppressionReason区分quiet_hours/platform_unavailable/disabled/budget_exhausted/stale_policy。Windows既有owner不支持，仍明确suppressed，不另起notifier。generic title/body不含任何日程/任务内容，锁屏亦然。

投递只在main进程显式发起，main退出后不补跑assistant分析；既有activity owner独立生命周期仍只观察原有业务。本功能不承诺OS exactly-once，crash unknown保留应用内卡不自动补响。

## 编码前对抗性自审

- source文本/renderer不能造quality/provider/tokenizer/canNotify、不能指定SQL路径或通知正文。
- Loop DB唯一writer不改变；activity owner只读该库，claim只写其现有activity库，不持跨owner事务await。
- 差集claim发生在main意图事务，owner claim与OS调用不混为业务完成；晚到ack不覆盖新policy。
- 取消/撤权发生在await期间：投递前重新查真实policy；未知不当未提交。禁用不改原用户任务watch.preference。
- 输入计量不确切则拒绝，字符/4不是token数。主进程时钟不可从IPC选择。
- 默认无真实质量资格/AnalysisPort，不创建active schedule、不新增分析或OS通知。合成测试只验证协议，不宣称真实质量通过。

质量资格实现：factory只接main已捕获的完整来源人口和user-owned人工标签，不能自行证明“人确实标注过”。冻结协议含source/account/epoch/window、风险规则digest、抽样seed；从人口按seed+ID哈希确定独立样本，不能只喂已生成建议。输出原始TP/FP/FN/unknown/严重漏报、全部分母与Wilson区间；行动样本≥30、总样本≥100、unknown≤10%、precision≥90%、recall≥95%、严重漏报0才可在本进程WeakMap签发opaque qualification。模型unknown在需要行动桶算FN；JSON复制token、账户/epoch/window变更均失效。main未装载真实标签时不签发，合成用例只验证算法，不计真实评估。


## 独立审查后收紧与明确限制（2026-11-01）

prepareDigest仅固定scheduler producer调用，非用户/IPC；同一Loop事务内先核对真实成功check run及complete source，才允许写差集ledger/预算意图。不存在或未完成run不能永久占用通知revision。

最终OS门禁必须有通知owner内的可信实时qualification回调，并核对当前qualityDigest/analysisContract。固定只读facts reader缺该回调时qualificationCurrent=false；当前production独立owner没有真实资格提供者，必定suppressed，即使旧DB留存enabled也不响。未来安装真实分析provider和人工资格时，仍须完成跨owner实时资格提供者，不能只读取policy里保存的digest冒充当前资格。本轮仅完成可回归的接缝，不把测试注入回调当作生产通知开通。

每个差集意图预占一次配额，免打扰/平台失败/未知仍保守占额度，避免退额与重放竞态；不会后台补响。quietHours相同起止表示全天静默。输出只有generic正文。

不对不响应取消的物理provider promise做超时后强制清active/启动第二请求；deadline传入provider，close继续拥有原promise。若provider违反取消契约，该进程可能停在busy并需要诊断/重启，不能声称工作已结束。生产未安装此类provider。reserved重启不盲目换绑或重新发送：同occurrence在创建新run前blocked，sent/settled只读；保留最坏预扣。后续新occurrence和原run恢复仍走原lease/预算owner。

预算审计保存真实user/scheduler triggerSource，手工刷新和调度共用父设计总额度，不拆两个可绕过的预算池。评估window是历史抽样窗口，并非token的有效期；资格比较账户/epoch/窗口及固定模型契约。阈值遵照父设计点估计+完整Wilson区间报告，不擅自把下界替换为父验收条件；100/30只授予限域试点最低覆盖，绝非泛化准确率证明。
