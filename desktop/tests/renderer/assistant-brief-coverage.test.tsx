import {cleanup,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
import {AssistantBriefConversation} from '../../renderer/src/components/assistant/AssistantBriefConversation';
import {AssistantCoverageView} from '../../renderer/src/components/assistant/AssistantAttentionList';
import type {AssistantCoverage,AssistantState} from '../../shared/assistant-inbox-contract';
afterEach(cleanup);
const coverage:AssistantCoverage[]=[{key:'mail:none',source:'mail',state:'unavailable',code:'not_connected',checkedAt:1793946389214},{key:'yzj_message:test',source:'yzj_message',state:'failed',code:'triage_failed',checkedAt:1793946389214}];
function brief(c:AssistantCoverage[],locale='zh',current=c){
 localStorage.setItem('xiaok:locale',locale);
 const state:AssistantState={items:[],briefs:[{id:'today',date:'2026-11-06',timeZone:'Asia/Shanghai',createdAt:1793946389214,needsYou:[],canWait:[],calendar:[],coverage:c}],coverage:current,outbox:[],active:true,scanning:false};
 return render(<LocaleProvider><AssistantBriefConversation state={state} controls={{busy:false,onStart:vi.fn(),onOpen:vi.fn(),onAct:vi.fn()}} onApprove={vi.fn()} onRefuse={vi.fn()}/></LocaleProvider>);
}
it('explains an unavailable brief without hiding reasons or implying nothing needs attention',()=>{
 brief(coverage);
 expect(screen.getByTestId('assistant-daily-brief')).toHaveTextContent('今日简报未能生成');
 expect(screen.queryByText('部分内容未能检查')).toBeNull();
 expect(screen.queryByText('暂时没有新的关注事项')).toBeNull();
 const list=screen.getByRole('list');
 expect(within(list).getByText(/邮件/)).toHaveTextContent('尚未连接，请在「连接来源」中添加。');
 expect(within(list).getByText(/云之家消息/)).toHaveTextContent('AI 整理未完成，请稍后刷新来源重试。');
 expect(list.closest('details')).toHaveAttribute('open');
});
it('does not treat a partially checked source as an unavailable brief',()=>{
 brief([{...coverage[1],state:'partial',code:'limited'}]);
 expect(screen.queryByText('今日简报未能生成')).toBeNull();
 expect(screen.getByTestId('assistant-daily-brief')).toHaveTextContent('已检查部分来源，暂未发现需要你处理的事项。');
});
it('keeps successful checks compact and distinguishes reading from AI failures',()=>{
 localStorage.setItem('xiaok:locale','zh');
 const c:AssistantCoverage[]=[{...coverage[1],state:'ok',code:undefined},{...coverage[0],state:'failed',code:'read_failed'}];
 const view=render(<LocaleProvider><AssistantCoverageView coverage={c}/></LocaleProvider>);
 expect(screen.getByRole('list')).toHaveTextContent('读取失败，请检查连接后刷新来源。');
 view.rerender(<LocaleProvider><AssistantCoverageView coverage={[c[0]]}/></LocaleProvider>);
 expect(screen.getByRole('list').closest('details')).not.toHaveAttribute('open');
});
it('explains the same distinctions in English',()=>{
 brief(coverage,'en');
 expect(screen.getByTestId('assistant-daily-brief')).toHaveTextContent('Today’s brief could not be prepared');
 expect(screen.getByRole('list')).toHaveTextContent('AI review did not finish. Try refreshing sources later.');
});

it('shows the latest scan after recovery instead of keeping the first failed brief warning forever',()=>{
 const latest:AssistantCoverage[]=[{...coverage[1],state:'partial',code:'limited',checkedAt:1793947389214}];
 brief(coverage,'zh',latest);
 expect(screen.queryByText('今日简报未能生成')).toBeNull();
 expect(screen.getByRole('list')).not.toHaveTextContent('AI 整理未完成');
 expect(screen.getByRole('list')).toHaveTextContent('已检查部分内容');
});
