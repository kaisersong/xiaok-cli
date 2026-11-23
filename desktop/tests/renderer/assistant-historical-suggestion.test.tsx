import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
import {AssistantAttentionList} from '../../renderer/src/components/assistant/AssistantAttentionList';
it('labels internal suggestions as dated observations rather than current failures',()=>{
 localStorage.setItem('xiaok:locale','zh');
 const item={id:'a'.repeat(64),revision:1,status:'suggested' as const,updatedAt:200,observedAt:100,source:'internal' as const,accountKey:'assistant',sourceId:'morning:1',title:'Check daily report',summary:'old',reason:'Old failure',nextStep:'Check',priority:'now' as const};
 render(<LocaleProvider><AssistantAttentionList items={[item]} busy={false} onStart={vi.fn()} onOpen={vi.fn()} onAct={vi.fn()}/></LocaleProvider>);
 expect(screen.getByTestId('assistant-suggestion-observation')).toHaveTextContent('历史建议');
});
