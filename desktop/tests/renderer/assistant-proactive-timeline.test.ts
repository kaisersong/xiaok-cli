import {it,expect} from 'vitest';
import {mergeAssistantMessages} from '../../renderer/src/lib/assistant-message-timeline';
const notice=(id:string,createdAt:number)=>({id,createdAt,kind:'test' as const,title:'Test',text:'hello'});
it('places durable assistant messages between complete turns and after the last turn',()=>{
 const chat=[{id:'u1',role:'user',content:'a',createdAt:10},{id:'a1',role:'assistant',content:'b'},{id:'r1',role:'result_card',content:''},{id:'u2',role:'user',content:'c',createdAt:30},{id:'a2',role:'assistant',content:'d'}];
 const result=mergeAssistantMessages(chat as never,[notice('n1',20),notice('n2',40)]);
 expect(result.map(m=>m.id)).toEqual(['u1','a1','r1','n1','u2','a2','n2']);
 expect(chat).toHaveLength(5);
});
it('deduplicates stable IDs, sorts notices and leaves a same-time notice after the complete turn',()=>{
 expect(mergeAssistantMessages([{id:'u',role:'user',content:'',createdAt:20}] as never,[notice('b',20),notice('a',5),notice('b',20)]).map(m=>m.id)).toEqual(['a','u','b']);
});
it('keeps un-timed legacy turns intact and uses bounded messages as durable input',()=>{
 expect(mergeAssistantMessages([{id:'legacy',role:'assistant',content:'old'}] as never,[notice('n',1)]).map(m=>m.id)).toEqual(['legacy','n']);
});
