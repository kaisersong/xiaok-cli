# Assistant launch admission implementation

复用正式 createTask 的 Room/Project/Goal/multi-agent 路径，不新建执行器。仅新会话；已有 Goal 显式附加后续开放，native 无幂等提交/查询则 blocked，不回退本地。

LoopStore 同一 SQLite owner 持久化 draft（10分钟）、operation、active claim。草稿绑定当前 publication/profile/revision 及 main 验证工作区/lane/permission binding；confirm 同事务比较 source/草稿、claim唯一、完整 instruction digest、proposal linked、operation accepted，重复 confirm 从 draft 查原 operation，拒绝不同 instruction。恢复不重新 dispatch 已 preparing/dispatch_pending/unknown；只查询原 owner，未知保留 claim。accepted 可在有效窗口内经当前检查后发起一次。

Host 增加 main-private assistant identity reservation：关联 operationId/requestDigest/threadId，同初始 snapshot 原子保存；不接受 TaskCreateInput/IPC 自定义任务身份。Desktop ALS 将本次 reservation 沿普通 foreground admission 传递至 localTaskHost.prepareTask；仍执行 prepareRoot、prepared inspect、Room/Project bind 和取消补偿。prepareRoot 为 boot scoped，重启后仅原 owner 恢复；不重建旧 reservation。主进程按已保存 taskId 只读 inspect 并比较 snapshot binding；无 checkpoint不能推导未执行。

prepare 后执行前在 host assertTaskAdmission 的最终同步尾检查 publication、工作区、permission revision；只拦首次启动，不阻断用户后续原会话 follow-up。新增启动默认 ask，不继承模型权限。确认 workspace 必须显式由 Desktop options.workspaceRoot 提供、可 realpath 且非根目录/HOME；没有明确绑定则 blocked，不把 process.cwd 当确认事实。native 当前 unsupported。

活动/结果读取原 inspect 快照；问题/审批导航原会话；terminal 显示待审，用户 resolve 绑定 result digest，不改 TaskHost 成功。终态 owner 回执才释放 active claim；不可达和删除请求不释放。UI确认显示指令及真实目录；confirm未知可用同draft查询。

对抗性自审：跨profile/agent/scheduler写默认拒绝；新 operation 必须 current source；已执行历史仅可查询关联原任务，无新授权。CAS与唯一索引抵御多窗口；dispatch抢占原子 accepted→preparing，单进程 promise仅优化不代替durable claim。source 变化发生在任意 await 后均在最终 host admission 再查。崩溃后 prepared 只定位、不自动重放。UI thread 仅缓存投影 main-issued threadId，不能分配第二实体。取消未执行操作须与 dispatch CAS 仲裁，运行中使用原任务 cancel，unknown 不释放。

## Kimi k3 design review / adjudication

独立模型首次 BLOCK（原票 /tmp/openduet-launch-review-20261101/design-output.jsonl）。逐项裁决：
1. 不采纳“未知时用户强制释放”：父设计§6.6明确禁止，可能重复执行。采用原owner只读仲裁+manual_repair手册；不以任意超时或用户一句确认释放。
2. 采纳TOCTOU问题：main实际工作区readiness为唯一授权根，解析后的目录identity(dev/ino)+实际cwd贯穿，执行点重验。不能把排除HOME/root当真正授权根；不新增凭空敏感路径denylist。
3. digest固定SHA256(canonicalVerificationJson({profileId,proposalId,revision,sourceVector,instruction完整原文,workspaceIdentity,lane,permissionRevision,threadBinding}))。不做trim/NFC，因为它会改变用户确认字节。result digest用原owner执行身份+result canonical JSON，键序固定。
4. 采纳审计：Loop DB append-only launch_events记录confirm/CAS拒绝/claim/dispatch/startGuard/终态释放，code+operationId+digest+时间，不存秘密/来源正文。
5. assistant仅new-thread普通用户任务；后续follow-up完全走原正式权限/Goal准入，不使用assistant旧授权；已有Goal附加不开放。

源码复核父设计§6.3要求跨owner可失效最终guard与lane commit同线仲裁。目前仅有publication只读isCurrent闭包，未证明具备跨owner撤权fence。故不能先用普通createTask或单次isCurrent检查开放Start；在guard契约闭合前提供草稿，明确unsupported。该限制保留父验收条件，不把blocked设计实现成假幂等。

## Narrow local lane commit protocol (revision 2)

解决上述guard缺口的限域实现：仅ordinary publication、Desktop main持有的显式workspace、本地正式lane（含multi-agent）；protected/native先blocked。Loop DB source observation + operation startCommitted + audit 同BEGIN IMMEDIATE事务，在TaskHost本任务mutation队列内同步调用一次consumeStartCommit。该函数无await：重查Loop源完整JSON/evidence、installed route仍ordinary、草稿TTL、实际workspace dev/ino/realpath、permission generation、取消标记，然后CAS dispatch_pending→start_committed。Host在同个同步尾紧接安装active execution，然后才await running snapshot fsync；该持久start_committed就是跨store admission fence（并非宣称工具已执行）。源变化若先于此事务则拒绝；晚于提交则属于已授权独立用户任务，不能伪称取消。Loop DB写者均通过同连接/SQLite串行，protected外部owner无共同fence故不可启用。

Host最早checkpoint包含assistantBinding={operationId,requestDigest,threadId}，来自main-only identity reservation弱映射而非TaskCreateInput。Loop operation先写preparing含taskId/threadId再执行正式createTask；ALS仅传这次reservation给普通foreground prepareTask，不绕Room/Project/Goal。新thread以Loop draft中main随机allocation原子分配，multi-agent正式registerThread落实实体；renderer只upsert同ID历史缓存。查到root binding但无checkpoint=unknown，不重prepare。所有已preparing operation只lookup；未dispatch accepted可在窗口内继续，过期blocked。原host可定位snapshot且binding完整才能导航；start_committed但running未写入=unknown/manual repair，不重发。只有终态真实snapshot释放claim。

确认输入digest使用父方案canonical JSON与完整原文，无NFC/trim。write audit与state CAS同事务。默认permissionMode=default，不能模型设置。重启prepared marker boot-scoped不自动恢复，保留定位与诊断。原问题回答/follow-up仍走原user能力，不继承assistantconfirm。

## Revision 3: B1/B2 closed explicitly

B1：host running checkpoint fsync 后、首次实际 runner 调用前，再同步调用 assertAssistantExecutionWorkspace；它重验绑定的 realpath/dev/ino 与实际执行cwd，不再检查来源（提交后的用户任务独立）。失败则进入原host失败/取消证据链，审计guard拒绝，不重新派发，不把失败误报完成。原runtime每次工具的workspace/permission边界继续保留，不以此一次身份检查替代。
B2：事务内与runner前的domain校验直接调用Desktop main实际服务：options.workspaceRoot的realpath/stat、实际multiAgentCwd、multiAgentWorkspaceId、multiAgentService.getExecutionAuthorization的bootId/permissionRevision/readiness；不是从Loop evidence或草稿复制授权值。main没有明确workspaceRoot则blocked。进程重启prepared不恢复旧reservation；started任务的后续用户操作仍走原权限服务。

## accepted follow_up

采纳仍只写候选决定。用户另点开始时，readAcceptedFollowUpSource通过相同ordinary/protected current reader，重查member.status=accepted/kind=follow_up/target=draft；由main构造follow_up action，完整原文≤4000、有效原事实refs≤20，无refs/超限保持不可启动。prepare生成draft绑定candidateId，confirm用该candidate重新读source，拒绝撤销/换正文/换向量。仍共享active claim和正式lane，不解析draft://为路径，不把memory/knowledge启动。旧已过24h接受记录只允许原手工草稿路径，不自动重放。

## Reconfirmation for proven undispatched work

仅state=blocked且taskId=null的operation可prepareReconfirmation：此组合由同DB dispatch CAS证明尚未进入正式create。main新草稿绑定原operationId/expectedRequestDigest/current source/full new domain；确认前不改原operation。confirmLaunch识别main持久reconfirmation草稿，在同事务重验old digest/blocked/taskId null/current source后写原operation新确认revision，保留完整旧payload至confirmation_history与旧draft→原operation别名；保持原active claim。preparing/unknown/任何已分配taskId一律禁止重确认；必须原owner先证明退役，不复用此入口绕过。新草稿ID重试仍指向同operation，不创建successor或换任务后偷执行。

开放门禁：main只有显式XIAOK_ASSISTANT_LOCAL_LAUNCH_PILOT=1才允许ordinary/local直接启动，默认不可用。当前实现是C真实对照所需的限域原型，不以mock/合成确认充当10案例A/B/C和20次真实试点；未完成该门槛前不默认公开Start。env不进入IPC或模型输出，不授予工具/权限；prepare与最终consume都重新检查。

## Cancellation fence

cancelLaunch仅user显式调用，持久cancelRequestedAt先于向原host.cancelTask提交。consumeStartCommit在同Loop事务拒绝已请求取消的operation，若start已commit则转原host取消，只有真实终态才显示cancelled/释放claim。accepted/blocked且taskId=null可由同DB CAS证明未派发并直接取消；preparing/unknown不可凭请求释放。原owner不可达保留cancel_pending/outcome_unknown。对重确认、confirm和cancel并发均重读同operation，cancelled不是可重确认态。
