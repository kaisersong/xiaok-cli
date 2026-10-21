import { expect, it } from 'vitest';
import { packCompletedExecutionAnchors } from '../../../src/runtime/sol-pi/semantic-execution-anchors.js';
import type { Message } from '../../../src/types.js';

it('packs only complete adjacent native protocol pairs, retaining exact ordered facts and text boundaries', () => {
 const history:Message[]=[{role:'user',content:[{type:'text',text:'Original authorization; never replace.'}]}];
 for(let i=0;i<20;i++) history.push(
  {role:'assistant',content:[{type:'tool_use',id:`t${i}`,name:'read',input:{file_path:`file-${i}`}}]},
  {role:'user',content:[{type:'tool_result',tool_use_id:`t${i}`,content:`exact result ${i}`,is_error:i===3}]});
 history.push({role:'user',content:[{type:'text',text:'Correction after execution.'}]});
 const frozen=structuredClone(history),result=packCompletedExecutionAnchors(history);
 expect(result).toHaveLength(3);expect(result[0]).toEqual(history[0]);expect(result[2]).toEqual(history.at(-1));
 const block=result[1].content[0];expect(block.type).toBe('text');if(block.type!=='text')throw Error();
 const tuples=JSON.parse(block.text.slice(block.text.indexOf('\n')+1));
 expect(tuples[3]).toEqual(['t3','read',{file_path:'file-3'},'exact result 3',true]);
 expect(tuples).toHaveLength(20);expect(history).toEqual(frozen);
 expect(JSON.stringify(result).length).toBeLessThan(JSON.stringify(history).length*.95);
});
it('keeps mixed user corrections, unpaired calls, private blocks and unknown fields unchanged',()=>{
 const cases:Message[][]=[
  [{role:'assistant',content:[{type:'tool_use',id:'t',name:'read',input:{}}]}],
  [{role:'assistant',content:[{type:'tool_use',id:'t',name:'read',input:{}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'t',content:'result'},{type:'text',text:'new instruction'}]}],
  [{role:'assistant',content:[{type:'thinking',thinking:'private'}]}],
  [{role:'assistant',content:[{type:'tool_use',id:'t',name:'read',input:{},futureField:'preserve'} as never]},{role:'user',content:[{type:'tool_result',tool_use_id:'t',content:'result'}]}],
 ];
 for(const value of cases)expect(packCompletedExecutionAnchors(value)).toEqual(value);
});
