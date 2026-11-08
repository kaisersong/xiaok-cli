import type { AssistantSource,AttentionItem,AssistantCoverage } from '../../../shared/assistant-inbox-contract';
export interface AssistantInboxLabels {
 testMessage:string;
 morningSuggestionsTitle:string;
 calendarDraft:string;calendarTitle:string;calendarStart:string;calendarEnd:string;calendarZone:string;calendarDescription:string;calendarDestination:string;calendarCreate:string;calendarRefuse:string;calendarAccepted:string;calendarRefused:string;calendarFailed:string;calendarUnknown:string;calendarSubmitting:string;
 title:string;now:string;later:string;working:string;brief:string;calendar:string;coverage:string;incomplete:string;unavailable:string;refresh:string;refreshing:string;empty:string;allDone:string;
 start:string;open:string;hide:string;resolve:string;snooze:string;retry:string;showAll:string;needsInput:string;ready:string;unknownTask:string;
 draft:string;to:string;subject:string;body:string;send:string;refuse:string;accepted:string;unknownSend:string;refused:string;failedSend:string;accountGrant:string;answer:string;answerPlaceholder:string;answerFilesUnsupported:string;
 count:(n:number)=>string;date:(date:string)=>string;
 sources:Record<AssistantSource,string>;statuses:Record<AttentionItem['status'],string>;
 errors:Record<string,string>;
 briefUnavailable:string;briefPartial:string;
 coverageStates:Record<AssistantCoverage['state'],string>;
 coverageReasons:Record<NonNullable<AssistantCoverage['code']>,string>;
}
export const assistantInboxZh:AssistantInboxLabels={
 testMessage:'发送测试消息',
 morningSuggestionsTitle:'最近一次晨间建议',
 calendarDraft:'确认创建云之家日程',calendarTitle:'日程标题',calendarStart:'开始时间',calendarEnd:'结束时间',calendarZone:'显示时区',calendarDescription:'日程说明',calendarDestination:'将创建到当前登录人的云之家主日历。',calendarCreate:'确认创建日程',calendarRefuse:'不创建',calendarAccepted:'日程已创建并回读核验。',calendarRefused:'本次日程未创建。',calendarFailed:'日程未能创建，请检查连接后重新准备。',calendarUnknown:'创建结果待核对。请先查看云之家日历，不要重复创建。',calendarSubmitting:'正在创建日程…',
 briefUnavailable:'今日简报未能生成',briefPartial:'已检查部分来源，暂未发现需要你处理的事项。',
 coverageStates:{ok:'已检查',partial:'仅检查了部分内容',unavailable:'本次未能检查',failed:'本次检查未完成',stale:'检查结果已过期，请刷新来源。'},
 coverageReasons:{not_connected:'尚未连接，请在「连接来源」中添加。',read_failed:'读取失败，请检查连接后刷新来源。',triage_failed:'AI 整理未完成，请稍后刷新来源重试。',account_changed:'账号设置已改变，请刷新来源重新检查。',limited:'已检查部分内容，可能仍有遗漏。',disabled:'此来源已暂停检查。'},
 title:'值得关注',now:'需要你',later:'可以等',working:'正在推进',brief:'今日简报',calendar:'今日日程',coverage:'检查情况',incomplete:'部分内容未能检查',unavailable:'未连接或暂不可用',refresh:'刷新来源',refreshing:'正在整理来源…',empty:'暂时没有新的关注事项',allDone:'这份简报中的事项已处理或暂时收起。',
 start:'开始处理',open:'打开对话',hide:'隐藏',resolve:'已解决',snooze:'稍后提醒',retry:'再试一次',showAll:'查看事项',needsInput:'等你决定',ready:'待你审阅',unknownTask:'执行状态待核对，请先打开原对话。',
 draft:'待确认发送',to:'收件人',subject:'主题',body:'完整正文',send:'确认并发送',refuse:'不发送',accepted:'已提交给服务商，不代表已经送达。',unknownSend:'发送结果尚未确认。请先核对发件箱或原会话，不要重复发送。',refused:'已取消这次发送',failedSend:'本次发送未完成，请检查连接后重新准备草稿。',accountGrant:'发送还需要账号开启发送权限。',answer:'回复并继续',answerPlaceholder:'告诉小K你的决定…',answerFilesUnsupported:'请先用文字或选项回答当前问题，再添加附件。',count:n=>`${n} 条需要关注`,date:date=>`${date} · 小K简报`,
 sources:{mail:'邮件',yzj_message:'云之家消息',yzj_calendar:'云之家日程',ai_news:'AI 动态',internal:'工作事项'},statuses:{suggested:'待处理',working:'正在推进',needs_input:'等你决定',ready:'待你审阅',failed:'未完成',resolved:'已解决',hidden:'已隐藏',unknown:'待核对'},
 errors:{assistant_stale_item:'事项已更新，请刷新后再操作。',assistant_user_only:'这项操作需要你在界面中确认。',assistant_start_unknown:'交办回执尚未确认，请先核对原任务，不要重复交办。',assistant_send_unknown:'发送结果未知，请先核对发件箱或原会话。',assistant_stale_draft:'草稿已更新，请核对最新内容后确认。',assistant_draft_conflict:'这份草稿已经处理，请查看最新状态。',assistant_send_failed:'发送未完成，请检查连接和发送权限。',mail_send_denied:'请先在邮箱连接设置中开启发送权限。',mail_stale_account:'邮箱设置已改变，请重新准备发送草稿。',assistant_executor_unavailable:'当前模型暂不支持该操作，请切换模型后重试。',failed:'操作未完成，请刷新确认最新状态。'}
};
export const assistantInboxEn:AssistantInboxLabels={
 testMessage:'Send a test message',
 morningSuggestionsTitle:'Latest morning suggestions',
 calendarDraft:'Confirm CloudHub calendar event',calendarTitle:'Event title',calendarStart:'Start time',calendarEnd:'End time',calendarZone:'Display time zone',calendarDescription:'Description',calendarDestination:'Create in the signed-in user’s primary CloudHub calendar.',calendarCreate:'Create event',calendarRefuse:'Do not create',calendarAccepted:'Calendar event created and verified.',calendarRefused:'This event was not created.',calendarFailed:'The event could not be created. Check the connection and prepare it again.',calendarUnknown:'The creation result is unknown. Check the calendar before trying again.',calendarSubmitting:'Creating the calendar event…',
 briefUnavailable:'Today’s brief could not be prepared',briefPartial:'Some sources were checked; no items needing you were found in that scope.',
 coverageStates:{ok:'Checked',partial:'Partially checked',unavailable:'Could not check this time',failed:'Check did not finish',stale:'Check results are out of date. Refresh sources.'},
 coverageReasons:{not_connected:'Not connected. Add it in Connected sources.',read_failed:'Reading failed. Check the connection and refresh sources.',triage_failed:'AI review did not finish. Try refreshing sources later.',account_changed:'Account settings changed. Refresh sources to check again.',limited:'Only part of the content was checked; some may be missing.',disabled:'Checks for this source are paused.'},
 title:'Worth your attention',now:'Needs you',later:'Can wait',working:'Working',brief:'Today’s brief',calendar:'Today’s calendar',coverage:'Coverage',incomplete:'Some information could not be checked',unavailable:'Not connected or unavailable',refresh:'Refresh sources',refreshing:'Checking sources…',empty:'No new items to review',allDone:'Items from this brief have been handled or put aside.',
 start:'Start',open:'Open conversation',hide:'Hide',resolve:'Resolved',snooze:'Remind me later',retry:'Try again',showAll:'View items',needsInput:'Needs input',ready:'Ready for review',unknownTask:'Execution status needs checking. Open the original conversation first.',
 draft:'Confirm before sending',to:'To',subject:'Subject',body:'Full message',send:'Confirm and send',refuse:'Do not send',accepted:'Accepted by the provider; delivery is not guaranteed.',unknownSend:'The sending result is unknown. Check Sent or the original conversation before sending again.',refused:'This send was cancelled',failedSend:'The message was not completed. Check the connection and prepare a new draft.',accountGrant:'The account must also allow sending.',answer:'Reply and continue',answerPlaceholder:'Tell K your decision…',answerFilesUnsupported:'Answer the current question before adding attachments.',count:n=>`${n} items to review`,date:date=>`${date} · K’s brief`,
 sources:{mail:'Mail',yzj_message:'Yunzhijia messages',yzj_calendar:'Yunzhijia calendar',ai_news:'AI news',internal:'Work'},statuses:{suggested:'To do',working:'Working',needs_input:'Needs input',ready:'Ready for review',failed:'Incomplete',resolved:'Resolved',hidden:'Hidden',unknown:'Check status'},
 errors:{assistant_stale_item:'This item changed. Refresh before acting.',assistant_user_only:'Confirm this action in the app.',assistant_start_unknown:'The handoff receipt is unknown. Check the original task before starting again.',assistant_send_unknown:'The sending result is unknown. Check Sent or the original conversation.',assistant_stale_draft:'This draft changed. Review the latest content.',assistant_draft_conflict:'This draft has already been handled. Check its current status.',assistant_send_failed:'Sending did not complete. Check the connection and send permission.',mail_send_denied:'Enable sending in the mail account settings first.',mail_stale_account:'Account settings changed. Prepare a new draft.',assistant_executor_unavailable:'This model cannot perform this action. Switch models and try again.',failed:'The operation did not complete. Refresh to check its latest status.'}
};
