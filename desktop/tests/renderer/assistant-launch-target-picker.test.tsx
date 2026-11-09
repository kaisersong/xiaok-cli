import {afterEach,it,expect,vi} from 'vitest';import {cleanup,render,screen,fireEvent} from '@testing-library/react';import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';import {AssistantLaunchTargetPicker} from '../../renderer/src/components/assistant/AssistantLaunchTargetPicker';afterEach(cleanup);
it('defaults to a new conversation and only submits a selected main-issued available thread',()=>{const onContinue=vi.fn();render(<LocaleProvider><AssistantLaunchTargetPicker items={[{threadId:'owned',title:'My conversation',available:true,reason:null},{threadId:'blocked',title:'Paused goal',available:false,reason:'goal_requires_new_thread'}]} busy={false} unavailable={false} hasMore={false} onMore={()=>{}} onContinue={onContinue} onClose={()=>{}}/></LocaleProvider>);
 fireEvent.click(screen.getByRole('button',{name:'继续确认'}));expect(onContinue).toHaveBeenLastCalledWith(undefined);
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'owned'}});fireEvent.click(screen.getByRole('button',{name:'继续确认'}));expect(onContinue).toHaveBeenLastCalledWith('owned');
 expect((screen.getByRole('option',{name:'Paused goal'}) as HTMLOptionElement).disabled).toBe(true);
});
