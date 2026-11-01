# P2 正式派生接线清单（当前代码）

本子任务只编辑runtime/executor/publication-context、新lineage helper/store及相应测试。没有编辑main.ts、LoopStore、CompletionEvidenceStore、actorAPI、P3 runtime、IPC、renderer/locales/workflow。真实日历本轮无任何调用；质量状态为待人工复核，无人工标签、无真实质量通过声明。

## 1. LoopStore 迁移/同事务 wrapper（由主线程接）

从assistant-derived-lineage-store.ts导入：

```ts
migrateAssistantDerivedLineage(db): void
recordAssistantDerivedSourceRun(db, {sourceRun,lineage}, isCurrent): void
readAssistantDerivedLineage(db, runId): AssistantDerivedLineage | undefined
isAssistantDerivedRunTracked(db, runId): boolean
```

迁移走现有LoopStore applySchema owner。record wrapper必须用现有transaction：BEGIN IMMEDIATE包住函数全程；**不要另调一次recordAssistantSourceRun**，该helper内部已同事务写coverage/source-run + marker + lineage并前后guard。拒绝非事务、非确切morning/evening运行中run owner；重放同内容幂等，不同内容冲突。runtime在调用模型前通过visibility.readLineage读回核对，避免noop/missing wrapper漏记。

marker用于区分应有lineage却丢失与合法legacy业务；保留到原owner已删除全部派生正文，不能单独删lineage/marker后让旧证据降为legacy。当前无自动清理源正文或新增第二DB。

## 2. 共用同步 reader gate

```ts
const visibility = createAssistantDerivedVisibility({
 readLineage: runId => store.readAssistantDerivedLineage(runId), // raw metadata, no public body getter
 isTrackedAssistantRun: runId => store.isAssistantDerivedRunTracked(runId), // 必传
 getProfile: id => currentProfileForId(id),
 currentCalendar: () => {
   const context = nativeCalendarContext();
   const snapshot = context.read();
   return context.isCurrent() && snapshot && snapshot.status !== 'disabled'
     && snapshot.status !== 'unavailable'
       ? {epoch:snapshot.epoch,events:snapshot.events} : undefined;
 },
 currentMemorySettings: (ownerId,profileId) => trustedSettings(ownerId,profileId),
 getMemory: id => memoryStore.getById?.(id),
 confirmMemory: record => publicationReader?.confirmMemory(record),
});
```

挂到实际LoopStore run/list/overview/evidence-preview/candidate读取和普通CompletionEvidenceStore readers：

- `visibility.isRunVisible(runId)`
- `visibility.isCandidateVisible({runId})`
- `visibility.isEvidenceVisible({ownerKind,ownerId})`（同样适用于validation/expectation等可含派生metadata的读取）

没有lineage且owner不追踪的run直接保持原业务读取行为，不检查默认assistant profile，不影响artifact/health/userloops；本应有lineage却丢失则false。确有lineage才检查profile存在/active/完整指纹、已使用calendar epoch+event observationRevision、memory consent revision+逐条内容hash+accepted确认、递归父run，任何不满足整份隐藏。循环/损坏fail closed。含外部lineage的run变成protected后同样隐藏，不能把ordinary正文借新protected route继续显示。

同一个gate必须覆盖原assistant run、历史ordinary evidence/metadata.output、建议、candidate、下一轮context；不能只遮卡片。实际DTO返回前同步复验，撤权时main/preload/renderer的epoch/缓存失效仍由主线程接。不得用这个gate删除/取消原任务或更改非assistant业务。

## 3. memory 确认专用事实口

```ts
const publicationReader = createAssistantPublicationContextReader({
 store, evidenceStore, publication,
 derivedVisibility: visibility,
 memoryOwner: () => ({ownerId:trustedOwner,profileId:trustedProfile,cwd:trustedCwd}),
 projectCwd: id => trustedProjectCwd(id),
 readMemoryConfirmationFacts: candidateId => finiteRawAcceptedPublicationFacts(candidateId),
});
// facts: {candidate: AssistantCandidate, run: LoopRun, revision: string, isCurrent():boolean}
```

事实口必须是有限accepted-candidate+原ordinary publication事实的raw专用reader，不调用已挂visibility的公共getAssistantCandidate/getLoopRun/listAssistantCandidates。用原行/当前route和publication revision构造同步tail closure；需要native异步observer时前置刷新，尾闭包无await，无证明即undefined。配置derived gate后helper拒绝fallback公共getter。

`publicationReader.confirmMemory(record)`核对status=accepted/kind=memory/targetKind、targetId、精确`memory://backend/id`、provenance candidateId/runId/backend、title/content、scope及project cwd、当前original run success/ordinary route/可见性、当前授权scopes。返回`{candidateId,contentHash,confirmationRevision,isCurrent}`，不是恒true。保护route缺共同同步证明返回无资格；未确认或被编辑记忆不进入输入。缺资格可正常空召回/明确unavailable，不能输出“无承诺”。

## 4. runtime capture（正式持久输出可接）

```ts
createAssistantRuntime({ ...,
 derived: {
  beginCapture: ({profile, now}) => beginAssistantDerivedCapture({
   profile, getProfile: () => currentProfile(), owner: () => trustedOwnerProfileCwd(),
   calendar: nativeCalendarContext, // collect前只捕获epoch，finish读取collect后快照
   memorySettings: () => currentIndependentMemorySettings(),
   memoryStore, confirmMemory: record => publicationReader.confirmMemory(record),
   visibility, now,
  }),
  recordCollection: (input,isCurrent) => store.recordAssistantDerivedSourceRun(input,isCurrent),
  visibility,
 }
})
```

先begin捕获profile/owner/calendar epoch/独立memory consent；原collect可刷新source，finish才取最终快照。collect不得擅自换账户/授权；前后不一致失败。旧裸calendar/personalization字段剔除，仅受控P2 context进入模型。无capture而有裸来源或非空derivedRunIds时在模型前拒绝。

lineage含version/profile fingerprint、calendar epoch/观测snapshot revision/实际输入event ids+observationRevision、memory owner/consent revision/IDs+contentHash+candidate确认revision、父runId+lineageHash。仅保留最小身份/摘要，不另复制原始外部正文。

模型后及每次stage/evidence/success前同步检查capture/current/route；撤权/变化后不发布，失败错误为稳定code不含私人错误原文。普通成功路径已经实际生成并存储P2prepare建议。任何含外部/继承派生的protected producer或模型期间route变protected：`assistant_derived_protected_unsupported`，不写ordinary正文，不伪造protected失败回执。

## 5. 展示、继承、launch 与人工复核

受控context提供未来48h与当前窗口内observed_changed的最多20条事件，独立记忆<=6条/8KiB。模型可以基于已知时间给准备建议或说明观测事实变化，不能从参会、缺失、未知取消/occurrence推导行动或取消。

`current.items.reference`加入`calendar_observation`/`memory_context`，本轮v2仍用实际输入refs验证。`listMorningSuggestions`正式展示ordinary evidence中的P2prepare；包含外部/继承派生的整个run不提供readMorningActionSource/readAcceptedFollowUpSource，避免模型换成task ref绕过未知场次的launch限制。未新增外部写工具。

buildMorningContext返回main-private `derivedRunIds`给capture继承；模型没有权扩展该集合。父run失效使下一轮混合摘要整份隐藏。人工抽样/复核走主线程新增main-only窗口，daily默认不改；这只是功能及安全回归，不宣称真实质量标签/准确率通过。

## 6. 已执行证据

`/tmp/p2-derived-red.log`、confirm-red、unrelated-red先失败；`/tmp/p2-derived-green.log`最新37项通过，覆盖runtime/pubcontext/executor/真实SQLite。含同事务故障回滚、owner marker/default不误伤、正式准备建议落evidence/展示而不launch、模型期间撤权和route变protected、memory accepted匹配与raw专用口不递归。build/typecheck/governance以及Kimi复审结果最终另记。
